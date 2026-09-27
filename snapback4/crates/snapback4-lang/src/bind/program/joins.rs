//! Refuse incompatible joins. Only flat row locals/reads get executable repairs.
use super::*;
use crate::types::JoinError;

impl Binder<'_> {
    pub(super) fn join(&self, a: &Ty, b: &Ty, left: &A, right: &A) -> Fallible<Ty> {
        a.join(b).map_err(|error| self.join_error_many(error, &[(a.clone(), left.clone()), (b.clone(), right.clone())]))
    }

    pub(super) fn join_error(&self, error: JoinError, a: &Ty, b: &Ty, left: &A, right: &A, condition: Option<&A>) -> Diagnostic {
        let rewrite = condition.and_then(|condition| {
            let (left, right, _, _) = self.simple_arms(&error, a, b, left, right)?;
            Some(format!("spread both arms:\nuse: ({left} if {} else {right})", print::expression(condition)))
        }).unwrap_or_default();
        refusal(error, right.site(), rewrite)
    }

    pub(super) fn assignment_join_error(&self, error: JoinError, name: &str, origins: &[(Ty, A)]) -> Diagnostic {
        let rewrite = (|| {
            let [(a, left), (b, right)] = origins else { return None; };
            if !self.adjacent_assignments(name, left, right) { return None; }
            let (left_value, right_value, left_ty, right_ty) = self.simple_arms(&error, a, b, left, right)?;
            // Reassignment also checks structural assignability after the join.
            if !left_ty.assignable_to(&right_ty) && !right_ty.assignable_to(&left_ty) { return None; }
            Some(format!("spread both assigned values at their original sites:\nat {} replace `{}`:\nuse: {left_value}\nat {} replace `{}`:\nuse: {right_value}",
                left.site(), self.catalog.source.expression(left), right.site(), self.catalog.source.expression(right)))
        })().unwrap_or_default();
        refusal(error, origins.last().unwrap().1.site(), rewrite)
    }

    fn adjacent_assignments(&self, name: &str, left: &A, right: &A) -> bool {
        self.catalog.documents.iter().any(|doc| {
            doc.programs.iter().any(|p| adjacent(&p.body, name, left, right) || adjacent(&p.prelude, name, left, right))
                || doc.functions.iter().any(|f| matches!(&f.body, ast::FunctionBody::Block(body) if adjacent(body, name, left, right)))
        })
    }

    // Coalescing, helpers, containers and internal joins get an explanation,
    // never source edits hoisted out of their evaluation context.
    pub(super) fn join_error_many(&self, error: JoinError, origins: &[(Ty, A)]) -> Diagnostic {
        refusal(error, origins.last().unwrap().1.site(), String::new())
    }

    fn simple_arms(&self, error: &JoinError, a: &Ty, b: &Ty, left: &A, right: &A) -> Option<(String, String, Ty, Ty)> {
        if !error.path.is_empty() || !simple_source(left) || !simple_source(right) || a.row_kind().is_none() || b.row_kind().is_none() {
            return None;
        }
        let normalize = |ty: &Ty, source: &A| {
            let fields = self.row_fields(ty, source.site()).ok()?.into_iter().collect();
            let normalized = Ty::RowObject(fields);
            Some(if ty.is_optional() { normalized.optional() } else { normalized })
        };
        let left_ty = normalize(a, left)?;
        let right_ty = normalize(b, right)?;
        // A top-level kind conflict can hide a second conflict in its fields.
        // Do not suggest a repair that would simply fail again one level down.
        left_ty.join(&right_ty).ok()?;
        Some((spread(left, a), spread(right, b), left_ty, right_ty))
    }

    pub(super) fn return_type(&self) -> Fallible<Ty> {
        let mut joined: Option<Ty> = None;
        for (ty, _) in &self.returns {
            joined = Some(match joined {
                Some(prior) => prior.join(ty).map_err(|error| self.join_error_many(error, &self.returns))?,
                None => ty.clone(),
            });
        }
        Ok(joined.unwrap_or(Ty::Null))
    }
}

pub(super) fn local(name: &str, site: &Site) -> A { A::Name { name: name.into(), site: site.clone() } }

fn simple_source(expression: &A) -> bool {
    matches!(expression, A::Name { .. } | A::Read(_))
        || matches!(expression, A::Assert { value, .. } if matches!(value.as_ref(), A::Read(_)))
}

fn spread(source: &A, ty: &Ty) -> String {
    let text = print::expression(source);
    if ty.is_optional() {
        // Shape evaluates its base once and skips its fields when absent;
        // reading the wrapper's field preserves that null. The selected
        // conditional/reassignment site keeps ownership of the whole read.
        format!("(({text}) {{ rowCopy: {{ ... . }} }}).rowCopy")
    } else { format!("{{ ...({text}) }}") }
}

fn description(kind: &str) -> &str {
    match kind {
        "Row" => "a row (Row)", "WriteRow" => "a write result (WriteRow)",
        "RowShape" => "a row shape (RowShape)", "RowObject" => "a spread object (RowObject)",
        "Object" => "a plain object (Object)", other => other,
    }
}

fn refusal(error: JoinError, site: &Site, rewrite: String) -> Diagnostic {
    let path = if error.path.is_empty() { String::new() } else { format!(" at field path {}", error.path) };
    if error.incompatible_items {
        let rewrite = if error.mixed_references {
            "use compatible item types; to expose references as generic ids, declare `fn exposedId(value: id): value` and use `[exposedId(x), exposedId(y)]`; for projected IDs (including field path [].id), use `exposedId(row.id)` in each id field"
        } else if error.enum_items {
            "use compatible item types; if every value is an enum variant, declare a typed helper such as `fn state(v: enum('on', 'off')): v` with all variants and use `[state(a), state(b)]` (or wrap each conflicting field); this preserves values without conversion; keep other incompatible types in separate lists"
        } else {
            "use compatible item types in one list; keep different types in separate lists"
        };
        return type_error(site, format!("cannot join list items{path}: {} and {}", error.left, error.right),
            rewrite);
    }
    Diagnostic::new(site, "E_QUARRY_SHAPE_JOIN",
        format!("cannot join{}: arm A is {}, arm B is {}; make both arms the same kind (spread both row arms, or shape both with the same shape)", path, description(&error.left), description(&error.right)),
        rewrite).guide("shapes")
}

// Normalizing an initial RowShape changes its wildcard rule. Only offer
// assignment edits when no intervening use can observe that changed kind.
fn adjacent(body: &[S], name: &str, left: &A, right: &A) -> bool {
    let assigns = |statement: &S, source: &A| matches!(statement,
        S::Bind { names, value, .. } if names.len() == 1 && names[0] == name && value == source);
    let mentions = |expr: &A| print::expression(expr).split(|c: char| !c.is_alphanumeric() && c != '_').any(|word| word == name);
    if mentions(right) { return false; }
    body.windows(2).any(|pair| {
        if !assigns(&pair[0], left) { return false; }
        if assigns(&pair[1], right) { return true; }
        matches!(&pair[1], S::If { condition, then_body, else_body, .. }
            if !mentions(condition) && ((then_body.len() == 1 && else_body.is_empty() && assigns(&then_body[0], right))
                || (else_body.len() == 1 && then_body.is_empty() && assigns(&else_body[0], right))))
    }) || body.iter().any(|statement| match statement {
        S::If { then_body, else_body, .. } => adjacent(then_body, name, left, right) || adjacent(else_body, name, left, right),
        S::For { body, .. } => adjacent(body, name, left, right),
        _ => false,
    })
}
