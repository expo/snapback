//! Merge sources share the statement loop's type checking and runtime domain.
use super::*;
use snapback4_core::ir::LaneSource;

impl Binder<'_> {
    // @ref LLP 3000.007#21.6 — query lanes take statement-for domains except walk; the meter bounds discovery.
    pub(super) fn lane_domain(&mut self, domain: &A, out: &mut setup::Body) -> Fallible<(LaneSource, Ty)> {
        if self.caller_kind != ProgramKind::Query && !matches!(domain, A::Read(_)) {
            return Err(crate::diag::syntax_with(domain.site(), "range and list merge lanes belong in queries", "read the merge in a query; keep the job or mutation's existing page loop").guide("reads"));
        }
        let (bound, ty) = self.loop_domain(domain, out).map_err(|error| {
            if matches!(error.code.as_str(), "E_UNBOUND_LOOP") || error.message.starts_with("for cannot iterate") || error.message.contains("static bound") {
                crate::diag::syntax_with(domain.site(), "a merge for lane requires a prefix page, range(a, b), or a bounded list", "for h in range(hour(now) - 24, hour(now) + 1), for a in authors (authors: [principal] <=50), or for row in table[prefix] by index").guide("reads")
            } else { error }
        })?;
        let source = match bound {
            LoopDomain::Page(scan) => LaneSource::Scan(scan),
            LoopDomain::LiteralRange { start, end_exclusive } => LaneSource::Range { start: ir::lit(Value::Int(start)), end_exclusive: ir::lit(Value::Int(end_exclusive)), max: Some(width(start, end_exclusive)) },
            LoopDomain::ExpressionRange { start, end_exclusive } => LaneSource::Range { start, end_exclusive, max: range_width(domain) },
            LoopDomain::ArgList { name, max } => LaneSource::List { value: ir::var(&name), max },
            LoopDomain::DerivedArray { value, max, .. } => LaneSource::List { value, max },
            LoopDomain::Recurse(_) => return Err(crate::diag::syntax_with(domain.site(), "a merge for lane requires a prefix page, range(a, b), or a bounded list; walk is not a lane domain", "for h in range(hour(now) - 24, hour(now) + 1), for a in authors (authors: [principal] <=50), or for row in table[prefix] by index").guide("reads")),
        };
        Ok((source, ty))
    }
}

fn width(start: i64, end: i64) -> u64 { (i128::from(end) - i128::from(start)).max(0) as u64 }

fn range_width(domain: &A) -> Option<u64> {
    fn affine(value: &A) -> Option<(Option<&A>, i64)> {
        if let Some(value) = literal_int(value) { return Some((None, value)); }
        if let A::Binary { op, left, right, .. } = value {
            if matches!(op.as_str(), "+" | "-") && let Some(n) = literal_int(right) {
                let (base, offset) = affine(left)?;
                return Some((base, if op == "+" { offset.checked_add(n)? } else { offset.checked_sub(n)? }));
            }
        }
        // This comparison is for stable scalar expressions only, never reads,
        // helper calls or new ids whose repeated evaluation may differ.
        fn stable(value: &A) -> bool {
            match value {
                A::Name { .. } | A::Literal { .. } => true,
                A::Unary { value, .. } => stable(value),
                A::Binary { left, right, .. } => stable(left) && stable(right),
                A::Call { name, args, .. } if matches!(name.as_str(), "day" | "hour" | "bucket") => args.iter().all(stable),
                _ => false,
            }
        }
        stable(value).then_some((Some(value), 0))
    }
    // @ref LLP 3000.007#14 — ruling 28's dynamic widths stay meter-bounded; only structurally equal stable bases admit offset folding.
    // Source locations do not matter, but precedence does: the printer is not
    // an identity for expressions such as (a + b) * 2 and a + b * 2.
    fn same(a: &A, b: &A) -> bool {
        match (a, b) {
            (A::Name { name: a, .. }, A::Name { name: b, .. }) => a == b,
            (A::Literal { value: a, .. }, A::Literal { value: b, .. }) => a == b,
            (A::Unary { op: a, value: av, .. }, A::Unary { op: b, value: bv, .. }) => a == b && same(av, bv),
            (A::Binary { op: a, left: al, right: ar, .. }, A::Binary { op: b, left: bl, right: br, .. }) => a == b && same(al, bl) && same(ar, br),
            (A::Call { name: a, args: av, .. }, A::Call { name: b, args: bv, .. }) => a == b && av.len() == bv.len() && av.iter().zip(bv).all(|(a, b)| same(a, b)),
            _ => false,
        }
    }
    let A::Call { args, .. } = domain else { return None };
    let (a, start) = affine(&args[0])?;
    let (b, end) = affine(&args[1])?;
    match (a, b) {
        (None, None) => Some(width(start, end)),
        (Some(a), Some(b)) if same(a, b) => Some(width(start, end)),
        _ => None,
    }
}

// A lane-dependent predicate needs the eager binding snapshot. Plain row
// predicates can keep the same head strategy as explicitly written lanes.
pub(super) fn filter_uses_lane(value: &A, name: &str) -> bool {
    match value {
        A::Name { name: used, .. } => used == name,
        A::Focal { .. } | A::Literal { .. } => false,
        A::Member { base, .. } | A::Unary { value: base, .. } => filter_uses_lane(base, name),
        A::Binary { left, right, .. } => filter_uses_lane(left, name) || filter_uses_lane(right, name),
        A::Call { args, .. } => args.iter().any(|arg| filter_uses_lane(arg, name)),
        _ => true,
    }
}
