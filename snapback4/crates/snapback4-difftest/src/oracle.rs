//! Full records accompany every verdict, including unsupported continuations.
use crate::{
    ast::*,
    execute::{self, Outcome},
    generate::Case,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback4_core::Ceilings;
use std::collections::{BTreeMap, BTreeSet};

pub const DIMENSIONS: [&str; 7] = [
    "examined",
    "index_entries",
    "rule_probes",
    "steps",
    "heap_bytes",
    "output_bytes",
    "rows_written",
];
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Rewrite {
    Commute,
    Identity,
    LazyOr,
    LazyAnd,
    Let,
    Declarations,
}
impl Rewrite {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Commute => "commute",
            Self::Identity => "identity",
            Self::LazyOr => "lazy-or",
            Self::LazyAnd => "lazy-and",
            Self::Let => "let",
            Self::Declarations => "declarations",
        }
    }
    /// Whether the rewrite may change meter fields. Commuting operands
    /// preserves cost only when neither hoists work: a read on the right of
    /// a binary operator makes the binder spill the left value first ("Work
    /// hoisted from the right cannot run before the left value",
    /// `bind/program/expr.rs`), two more steps. Order of evaluation, not cost,
    /// is the language's promise there.
    pub fn costs(&self, p: &Program) -> bool {
        match self {
            Self::Declarations => false,
            Self::Commute => match &p.body {
                Body::Scalar(e) | Body::Write(_, e) | Body::Block(Block { ret: e, .. }) => reads(e),
                _ => false,
            },
            _ => true,
        }
    }
    /// Commuting a refused expression can reach the failing operand before
    /// evaluating the other one. Preserve the refusal, not its executed cost.
    // @ref LLP 3000.035#51-stage-1-a-generator-and-rust-against-rust-comparison — refused commutations compare semantics; the report counts omitted meters.
    pub fn costs_for(&self, p: &Program, outcome: &Outcome) -> bool {
        self.costs(p) || (matches!(self, Self::Commute) && outcome.refusal().is_some())
    }
    pub fn apply(&self, p: &Program) -> Option<Program> {
        let mut q = p.clone();
        match self {
            Self::Declarations => q.reverse = !q.reverse,
            Self::Let => q.bind_return = !q.bind_return,
            Self::Commute | Self::Identity => {
                let e = match &mut q.body {
                    Body::Scalar(e)
                    | Body::Write(Write::Insert | Write::Upsert | Write::Update, e) => e,
                    Body::Block(b) => &mut b.ret,
                    _ => return None,
                };
                if let Expr::Binary(op, a, b) = e {
                    if matches!(self, Self::Commute) {
                        if !matches!(op, Bin::Add | Bin::Mul | Bin::Eq) {
                            return None;
                        }
                        std::mem::swap(a, b);
                    } else if matches!(op, Bin::Add | Bin::Mul) {
                        *a = Box::new(Expr::Identity(a.clone()));
                        *b = Box::new(Expr::Identity(b.clone()));
                        q.helper = true;
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            Self::LazyOr | Self::LazyAnd => {
                let is_or = matches!(self, Self::LazyOr);
                if matches!(&q.body, Body::Scalar(Expr::Binary(op, left, _))
                    if matches!((op, is_or), (Bin::Or, true) | (Bin::And, false)) && matches!(left.as_ref(), Expr::Bool(b) if *b == is_or))
                {
                    q.body = Body::Scalar(Expr::Bool(is_or));
                } else if matches!(&q.body,Body::Scalar(Expr::Bool(b)) if *b==is_or) {
                    let bad = Expr::Binary(
                        Bin::Eq,
                        Box::new(Expr::Assert(Box::new(Expr::Arg(
                            "n".into(),
                            Type::Nullable(Box::new(Type::Int)),
                        )))),
                        Box::new(Expr::Int(0)),
                    );
                    q.body = Body::Scalar(Expr::Binary(
                        if is_or { Bin::Or } else { Bin::And },
                        Box::new(Expr::Bool(is_or)),
                        Box::new(bad),
                    ));
                } else {
                    return None;
                }
            }
        }
        Some(q)
    }
}
/// Whether an expression performs a read (which the binder hoists).
fn reads(e: &Expr) -> bool {
    match e {
        Expr::Score(_) | Expr::Present(_) | Expr::Point(..) => true,
        Expr::Binary(_, a, b) => reads(a) || reads(b),
        Expr::Identity(a) | Expr::Assert(a) | Expr::Calendar(_, a) => reads(a),
        Expr::RoundedDivide(_, _, a, b) => reads(a) || reads(b),
        _ => false,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Oracle {
    Repeat,
    /// A timed non-uniform search with its physically future rows present
    /// against the same logical world with those rows absent.
    TimedSearchFutureAbsence,
    StoreSqliteRepeat {
        dimension: Option<String>,
        ceiling: u64,
    },
    Store {
        prefetch: bool,
        dimension: Option<String>,
        ceiling: u64,
    },
    Rewrite(Rewrite),
    Meter {
        dimension: String,
        ceiling: u64,
    },
    /// Server against a device store (`devices.rs`): phase `read`, a meter
    /// dimension at `ceiling`, `write` or `converge`.
    Device {
        store: String,
        phase: String,
        ceiling: u64,
    },
    /// The engine against the Lean model (`lean.rs`, LLP 3000.035 §5.2).
    Lean,
}
impl Oracle {
    pub fn name(&self) -> String {
        match self {
            Self::Repeat => "repeat".into(),
            Self::TimedSearchFutureAbsence => "timed-search-future-absence".into(),
            Self::StoreSqliteRepeat { .. } => "store-sqlite-mutation-repeat".into(),
            Self::Store { prefetch, .. } => {
                format!("store-postgres-{}", if *prefetch { "on" } else { "off" })
            }
            Self::Rewrite(r) => format!("rewrite-{}", r.name()),
            Self::Meter { .. } => "meter".into(),
            Self::Device { store, .. } => format!("device-{store}"),
            Self::Lean => "lean".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoreTrace {
    pub left: Vec<Outcome>,
    pub right: Vec<Outcome>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Finding {
    pub signature: String,
    pub oracle: Oracle,
    pub field: String,
    pub left: Outcome,
    pub right: Outcome,
    pub continuation: Vec<Outcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_trace: Option<StoreTrace>,
}
#[derive(Clone, Debug)]
pub enum Verdict {
    Pass,
    Unsupported(String),
    /// A documented outcome the oracle recognises by an exact condition
    /// (`device_writes.rs::UNHELD_UNIQUE`): counted under its name, never as a
    /// pass and never as a disagreement.
    Named(String),
    Disagree(Finding),
}
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Counts {
    pub attempted: u64,
    pub passed: u64,
    pub unsupported: BTreeMap<String, u64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub named: BTreeMap<String, u64>,
    pub disagreeing: u64,
    pub signatures: BTreeMap<String, u64>,
    pub meter_fields_omitted: u64,
}
impl Counts {
    pub fn record(&mut self, v: &Verdict) {
        self.attempted += 1;
        match v {
            Verdict::Pass => self.passed += 1,
            Verdict::Unsupported(s) => *self.unsupported.entry(s.clone()).or_default() += 1,
            Verdict::Named(s) => *self.named.entry(s.clone()).or_default() += 1,
            Verdict::Disagree(f) => {
                self.disagreeing += 1;
                *self.signatures.entry(f.signature.clone()).or_default() += 1;
            }
        }
    }
}
fn class(o: &Outcome) -> String {
    if let Some(r) = o.refusal() {
        return r["code"].as_str().unwrap_or("refusal").to_owned();
    }
    match o.data() {
        Some(Json::Object(v)) => v
            .keys()
            .next()
            .map(String::as_str)
            .unwrap_or("object")
            .to_lowercase(),
        Some(Json::Array(_)) => "array".into(),
        Some(Json::Null) => "null".into(),
        Some(Json::Bool(_)) => "bool".into(),
        Some(Json::Number(_)) => "number".into(),
        _ => "value".into(),
    }
}
pub fn disagreement(
    oracle: &Oracle,
    field: &str,
    left: Outcome,
    right: Outcome,
    continuation: Vec<Outcome>,
) -> Verdict {
    Verdict::Disagree(Finding {
        signature: format!(
            "{}--{}--{}",
            oracle.name(),
            field.replace('_', "-"),
            class(&right)
        ),
        oracle: oracle.clone(),
        field: field.into(),
        left,
        right,
        continuation,
        store_trace: None,
    })
}
pub fn field(a: &Outcome, b: &Outcome, omit_meter: bool) -> Option<String> {
    if a.kind != b.kind {
        return Some("kind".into());
    }
    let keys: BTreeSet<_> = a
        .value
        .as_object()
        .unwrap()
        .keys()
        .chain(b.value.as_object().unwrap().keys())
        .collect();
    // Data and the complete refusal envelope always precede bookkeeping.
    for key in ["data", "result", "refusal", "why"]
        .into_iter()
        .chain(keys.into_iter().map(String::as_str))
    {
        if omit_meter && key == "metered" {
            continue;
        }
        if a.value.get(key) != b.value.get(key) {
            return Some(key.into());
        }
    }
    None
}
pub fn rewrite(case: &Case, r: &Rewrite, source: &str) -> Result<(Verdict, u64), String> {
    if r.apply(&case.program).is_none() {
        return Ok((Verdict::Unsupported("rewrite-not-applicable".into()), 0));
    }
    let (mut left, prelude) = execute::world(case, source)?;
    let a = execute::execute(&mut left, case, "run", &case.args);
    rewrite_against(case, r, &mut left, &prelude, &a).map(|(v, n)| (v, n + 1))
}

/// The first differing prelude outcome (`prelude-{field}`), if any.
pub fn prelude_field(a: &[Outcome], b: &[Outcome], omit_meter: bool) -> Option<(String, usize)> {
    for (i, (x, y)) in a.iter().zip(b).enumerate() {
        if let Some(f) = field(x, y, omit_meter) {
            return Some((format!("prelude-{f}"), i));
        }
    }
    (a.len() != b.len()).then(|| ("prelude-length".into(), a.len().min(b.len())))
}
pub fn prelude_disagreement(oracle: &Oracle, a: &[Outcome], b: &[Outcome], omit_meter: bool) -> Option<Verdict> {
    let (f, i) = prelude_field(a, b, omit_meter)?;
    let blank = || Outcome { kind: "absent".into(), value: json!({}) };
    let x = a.get(i).cloned().unwrap_or_else(blank);
    let y = b.get(i).cloned().unwrap_or_else(blank);
    let mut trail = a.to_vec();
    trail.extend(b.iter().cloned());
    Some(disagreement(oracle, &f, x, y, trail))
}

/// Reuse the unchanged original world's outcome across independent rewrites.
/// The only subsequent calls on that world are queries; each right world is fresh.
pub fn rewrite_against(
    case: &Case,
    r: &Rewrite,
    left: &mut snapback4_core::Engine,
    left_prelude: &[Outcome],
    a: &Outcome,
) -> Result<(Verdict, u64), String> {
    let oracle = Oracle::Rewrite(r.clone());
    let Some(program) = r.apply(&case.program) else {
        return Ok((Verdict::Unsupported("rewrite-not-applicable".into()), 0));
    };
    let (mut right, right_prelude) = execute::world(case, &program.source())?;
    if let Some(v) = prelude_disagreement(&oracle, left_prelude, &right_prelude, r.costs(&case.program)) {
        return Ok((v, right_prelude.len() as u64));
    }
    let b = execute::execute(&mut right, case, "run", &case.args);
    let mapped = crate::sites::corresponding(left, &right, &b);
    // @ref LLP 3000.035#51-stage-1-a-generator-and-rust-against-rust-comparison — differing let-plan tokens compare through their own continuations.
    let cursor_rewrite = matches!(r, Rewrite::Let) && a.next() != mapped.next()
        && a.next().is_some() && mapped.next().is_some();
    let compare = |a: &Outcome, b: &Outcome| {
        if !cursor_rewrite { return field(a, b, r.costs_for(&case.program, a)); }
        // A let can hoist a static point predicate and select a different
        // proved page plan. Its cursor is opaque: compare presence here and
        // consume each plan's own token below, preserving all other fields.
        let mut a = a.clone();
        let mut b = b.clone();
        a.value["next"] = json!(a.next().is_some());
        b.value["next"] = json!(b.next().is_some());
        field(&a, &b, r.costs_for(&case.program, &a))
    };
    if let Some(f) = compare(a, &mapped) {
        return Ok((disagreement(&oracle, &f, a.clone(), b, vec![]), 1));
    }
    let mut executions = 1;
    if cursor_rewrite {
        let mut next = (a.next().map(str::to_owned), b.next().map(str::to_owned));
        let mut trail = vec![a.clone(), b.clone()];
        let mut left_args = case.args.clone();
        let mut right_args = case.args.clone();
        // Prelude mutations and maintained rows are part of the population.
        // Each advancing token consumes a position; allow a terminal empty page.
        let population = |engine: &snapback4_core::Engine| {
            engine.schema().tables.keys().try_fold(0_u64, |n, table|
                engine.store().count(table).map(|count| n.saturating_add(count)))
                .map_err(|error| error.to_string())
        };
        let limit = population(left)?.max(population(&right)?);
        for _ in 0..=limit {
            let (Some(x), Some(y)) = next else { return Ok((Verdict::Pass, executions)); };
            left_args["c"] = json!(x);
            right_args["c"] = json!(y);
            let x = execute::execute(left, case, "run", &left_args);
            let y = execute::execute(&mut right, case, "run", &right_args);
            executions += 2;
            let mapped = crate::sites::corresponding(left, &right, &y);
            if let Some(f) = compare(&x, &mapped) {
                return Ok((disagreement(&oracle, &format!("continuation-{f}"), x, y, trail), executions));
            }
            next = (x.next().map(str::to_owned), y.next().map(str::to_owned));
            trail.extend([x, y]);
            if matches!(next, (None, None)) { return Ok((Verdict::Pass, executions)); }
        }
        return Err("let-rewrite continuation did not terminate".into());
    }
    if case.program.mutation() {
        let x = execute::execute(left, case, "observe", &case.args);
        let y = execute::execute(&mut right, case, "observe", &case.args);
        executions += 2;
        if let Some(f) = field(&x, &y, false) {
            return Ok((
                disagreement(&oracle, &format!("post-{f}"), x, y, vec![a.clone(), b]),
                executions,
            ));
        }
    }
    Ok((Verdict::Pass, executions))
}

pub fn ceiling(dimension: &str, n: u64) -> Ceilings {
    let mut c = serde_json::to_value(Ceilings::unbounded()).unwrap();
    c[dimension] = json!(n);
    serde_json::from_value(c).unwrap()
}
pub fn reproduce(case: &Case, source: &str, oracle: &Oracle) -> Result<Verdict, String> {
    match oracle {
        Oracle::Repeat => repeat(case, source).map(|v| v.0),
        Oracle::TimedSearchFutureAbsence => timed_search_future_absence(case, source).map(|v| v.0),
        Oracle::Store { .. } | Oracle::StoreSqliteRepeat { .. } => {
            #[cfg(feature = "postgres")]
            {
                crate::stores::reproduce(case, source, oracle)
            }
            #[cfg(not(feature = "postgres"))]
            {
                Err("store replay requires --features postgres and SNAPBACK4_EVAL_POSTGRES".into())
            }
        }
        Oracle::Rewrite(r) => rewrite(case, r, source).map(|v| v.0),
        Oracle::Device { .. } => crate::devices::reproduce(case, source, oracle),
        Oracle::Lean => crate::lean::reproduce(case, source),
        Oracle::Meter {
            dimension,
            ceiling: n,
        } => {
            let mut e = execute::engine(case, source)?;
            e.set_ceilings(Ceilings::unbounded());
            let baseline = execute::execute(&mut e, case, "run", &case.args);
            if baseline.refusal().is_some() {
                return Ok(Verdict::Unsupported("uncut-refusal".into()));
            }
            Ok(crate::meter::check(case, &mut e, &baseline, dimension, *n).0)
        }
    }
}

pub fn repeat(case: &Case, source: &str) -> Result<(Verdict, u64), String> {
    let (mut left, p) = execute::world(case, source)?;
    let (mut right, q) = execute::world(case, source)?;
    if let Some(v) = prelude_disagreement(&Oracle::Repeat, &p, &q, false) {
        return Ok((v, 2 * p.len() as u64));
    }
    let a = execute::execute(&mut left, case, "run", &case.args);
    let b = execute::execute(&mut right, case, "run", &case.args);
    if let Some(f) = field(&a, &b, false) {
        return Ok((disagreement(&Oracle::Repeat, &f, a, b, vec![]), 2));
    }
    if case.program.mutation() {
        let x = execute::execute(&mut left, case, "observe", &case.args);
        let y = execute::execute(&mut right, case, "observe", &case.args);
        if let Some(f) = field(&x, &y, false) {
            return Ok((
                disagreement(&Oracle::Repeat, &format!("post-{f}"), x, y, vec![a, b]),
                4,
            ));
        }
        return Ok((Verdict::Pass, 4));
    }
    Ok((Verdict::Pass, 2))
}

/// Exact paired worlds for the timed word-head composition. Each world uses
/// its own cursor, but every complete outcome record (including meter and the
/// continuation token) must agree page by page.
pub fn timed_search_future_absence(case: &Case, source: &str) -> Result<(Verdict, u64), String> {
    if case.program.search_term.is_none() {
        return Ok((Verdict::Unsupported("not-timed-search".into()), 0));
    }
    let mut absent = case.clone();
    absent.rows.retain(|(_, row)| row.get("opensAt").is_none_or(|opens| {
        opens.is_null() || opens.as_i64().is_some_and(|at| at <= case.clock)
    }));
    let mut left = execute::world(&absent, source)?.0;
    let mut right = execute::world(case, source)?.0;
    let oracle = Oracle::TimedSearchFutureAbsence;
    let mut left_args = absent.args.clone();
    let mut right_args = case.args.clone();
    let mut trail = Vec::new();
    for page in 0..=case.rows.len() + 1 {
        let a = execute::execute(&mut left, &absent, "run", &left_args);
        let b = execute::execute(&mut right, case, "run", &right_args);
        if let Some(field) = field(&a, &b, false) {
            return Ok((disagreement(&oracle, &format!("{}{}", if page == 0 { "" } else { "continuation-" }, field), a, b, trail), 2 * (page as u64 + 1)));
        }
        let next = (a.next().map(str::to_owned), b.next().map(str::to_owned));
        trail.extend([a, b]);
        match next {
            (Some(a), Some(b)) => {
                left_args["c"] = json!(a);
                right_args["c"] = json!(b);
            }
            (None, None) => return Ok((Verdict::Pass, 2 * (page as u64 + 1))),
            _ => unreachable!("the exact outcome comparison includes next"),
        }
    }
    Err("timed search continuation did not terminate".into())
}
