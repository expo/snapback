//! Refuse at the first incompatible join; source expressions serve rewrites only.
use super::*;
use crate::types::JoinError;

#[derive(Default)]
struct Arm {
    setup: Vec<String>,
    value: String,
}

struct Rewrite<'a, 'b> {
    binder: &'a Binder<'b>,
    names: std::collections::BTreeSet<String>,
    plain: bool,
}

impl Binder<'_> {
    pub(super) fn join(&self, a: &Ty, b: &Ty, left: &A, right: &A) -> Fallible<Ty> {
        a.join(b).map_err(|error| self.join_error(error, a, b, left, right, None))
    }

    pub(super) fn join_error(&self, error: JoinError, a: &Ty, b: &Ty, left: &A, right: &A, condition: Option<&A>) -> Diagnostic {
        let Some(condition) = condition else { return self.join_error_many(error, &[(a.clone(), left.clone()), (b.clone(), right.clone())]); };
        let row = |kind: &str| matches!(kind, "Row" | "WriteRow" | "RowShape" | "RowObject");
        let plain = !row(&error.left) || !row(&error.right);
        let mut rewrite = Rewrite { binder: self, names: self.rewrite_names(), plain };
        let wrap = wrap_result(&error);
        let mut left_arm = rewrite.arm(left, a);
        let mut right_arm = rewrite.arm(right, b);
        if wrap {
            left_arm.value = format!("{{ value: {} }}", left_arm.value);
            right_arm.value = format!("{{ value: {} }}", right_arm.value);
        }
        let action = if wrap { "project row fields and wrap both arms in { value: ... }; read the result through .value" } else if plain { "project both arms to plain objects without pending metadata" } else { "spread both arms" };
        let arm = rewrite.choose(&print::expression(condition), left_arm, right_arm, !wrap && (a.is_optional() || b.is_optional()));
        let text = format!("{action}; keep setup inside the selected arm:\n{}use: {}", lines(&arm.setup), arm.value);
        refusal(error, right.site(), text)
    }

    pub(super) fn join_error_many(&self, error: JoinError, origins: &[(Ty, A)]) -> Diagnostic {
        let row = |kind: &str| matches!(kind, "Row" | "WriteRow" | "RowShape" | "RowObject");
        let plain = !row(&error.left) || !row(&error.right);
        let mut rewrite = Rewrite { binder: self, names: self.rewrite_names(), plain };
        let wrap = wrap_result(&error);
        let action = if wrap { "project row fields and wrap every arm in { value: ... }; read the result through .value" } else if plain { "project the arms to plain objects without pending metadata" } else { "spread every contributing arm" };
        let mut text = format!("{action}; insert each setup at its own statement, keeping its branch:");
        for (ty, source) in origins {
            let mut arm = rewrite.arm(source, ty);
            if wrap { arm.value = format!("{{ value: {} }}", arm.value); }
            text.push_str(&format!("\nat {} replace `{}`:\n{}use: {}", source.site(), print::expression(source), lines(&arm.setup), arm.value));
        }
        refusal(error, origins.last().unwrap().1.site(), text)
    }

    fn rewrite_names(&self) -> std::collections::BTreeSet<String> {
        let mut names: std::collections::BTreeSet<_> = self.scopes.iter().flat_map(|scope| scope.keys().cloned()).collect();
        for doc in &self.catalog.documents {
            for program in &doc.programs {
                names.extend(program.args.iter().map(|arg| arg.name.clone()));
                declared_names(&program.body, &mut names);
                declared_names(&program.prelude, &mut names);
            }
            for function in &doc.functions {
                names.extend(function.args.iter().map(|arg| arg.name.clone()));
                if let ast::FunctionBody::Block(body) = &function.body { declared_names(body, &mut names); }
            }
        }
        for (name, table) in &self.catalog.tables {
            names.insert(name.clone());
            names.extend(table.columns.keys().cloned());
        }
        names.extend(self.catalog.view_reads.keys().cloned());
        names
    }

    pub(super) fn return_type(&self) -> Fallible<Ty> {
        let mut joined: Option<(Ty, &A)> = None;
        for (ty, source) in &self.returns {
            joined = Some(match joined {
                Some((prior, first)) => (prior.join(ty).map_err(|error| self.join_error_many(error, &self.returns))?, first),
                None => (ty.clone(), source),
            });
        }
        Ok(joined.map_or(Ty::Null, |(ty, _)| ty))
    }
}

impl Rewrite<'_, '_> {
    fn fresh(&mut self, suffix: &str) -> String {
        let stem: String = self.binder.name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        for n in 1.. {
            let name = format!("{stem}{suffix}{n}");
            if self.names.insert(name.clone()) { return name; }
        }
        unreachable!()
    }

    fn choose(&mut self, condition: &str, left: Arm, right: Arm, nullable: bool) -> Arm {
        if left.setup.is_empty() && right.setup.is_empty() {
            return Arm { setup: vec![], value: format!("({} if {condition} else {})", left.value, right.value) };
        }
        // A one-item collector lets this rewrite preserve lazy evaluation for
        // arbitrary result types without an eager initializer from either arm.
        let target = self.fresh("Arms");
        let mut setup = vec![format!("{target} = []"), format!("if {condition}:")];
        for (index, arm) in [left, right].into_iter().enumerate() {
            if index == 1 { setup.push("else:".into()); }
            setup.extend(arm.setup.into_iter().map(|line| format!("  {line}")));
            setup.push(format!("  {target} = {target} + [{}]", arm.value));
        }
        Arm { setup, value: format!("first({target}){}", if nullable { "" } else { " ! else NOT_FOUND" }) }
    }

    fn arm(&mut self, expression: &A, ty: &Ty) -> Arm {
        let text = print::expression(expression);
        if let Ty::Optional(inner) = ty {
            let (setup, source) = self.once(expression);
            let present = self.arm(&source, inner);
            let mut arm = self.choose(&format!("{} != null", print::expression(&source)), present, Arm { value: "null".into(), ..Arm::default() }, true);
            let mut all = setup;
            all.append(&mut arm.setup);
            arm.setup = all;
            return arm;
        }
        if ty.row_kind().is_some() && !self.plain {
            return Arm { value: format!("{{ ...({text}) }}"), ..Arm::default() };
        }
        if let Some((item, _)) = ty.sequence() {
            if let A::Array { items, .. } = expression {
                let mut setup = vec![];
                let mut values = vec![];
                for expression in items {
                    let arm = self.arm(expression, &item);
                    setup.extend(arm.setup);
                    values.push(arm.value);
                }
                return Arm { setup, value: format!("[{}]", values.join(", ")) };
            }
            let target = self.fresh("Rows");
            let name = self.fresh("Row");
            let arm = self.arm(&local(&name, expression.site()), &item);
            let mut setup = vec![format!("{target} = []"), format!("for {name} in {text}:")];
            setup.extend(arm.setup.into_iter().map(|line| format!("  {line}")));
            setup.push(format!("  {target} = {target} + [{}]", arm.value));
            return Arm { setup, value: target };
        }
        if matches!(ty, Ty::Row(_) | Ty::WriteRow(_) | Ty::RowShape(_) | Ty::RowObject(_) | Ty::Object(_)) {
            let (mut setup, source) = self.once(expression);
            let mut values = vec![];
            for (name, field_ty) in self.binder.row_fields(ty, expression.site()).unwrap_or_default() {
                let field = A::Member { base: Box::new(source.clone()), name: name.clone(), site: expression.site().clone() };
                let arm = self.arm(&field, &field_ty);
                setup.extend(arm.setup);
                values.push(format!("{name}: {}", arm.value));
            }
            return Arm { setup, value: format!("{{ {} }}", values.join(", ")) };
        }
        Arm { value: text, ..Arm::default() }
    }

    fn once(&mut self, expression: &A) -> (Vec<String>, A) {
        if stable(expression) { return (vec![], expression.clone()); }
        let name = self.fresh("Source");
        (vec![format!("{name} = {}", print::expression(expression))], local(&name, expression.site()))
    }
}

fn lines(lines: &[String]) -> String { lines.iter().map(|line| format!("{line}\n")).collect() }

pub(super) fn local(name: &str, site: &Site) -> A { A::Name { name: name.into(), site: site.clone() } }

fn stable(expression: &A) -> bool {
    match expression {
        A::Name { .. } | A::Focal { .. } => true,
        A::Member { base, .. } => stable(base),
        _ => false,
    }
}

fn refusal(error: JoinError, site: &Site, rewrite: String) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_SHAPE_JOIN",
        format!("cannot join {} and {}; row-derived arms must have the same kind", error.left, error.right), rewrite).guide("shapes")
}

fn wrap_result(error: &JoinError) -> bool {
    [&error.left, &error.right].iter().any(|kind| !matches!(kind.as_str(), "Row" | "WriteRow" | "RowShape" | "RowObject" | "Object"))
}

fn declared_names(statements: &[S], names: &mut std::collections::BTreeSet<String>) {
    for statement in statements {
        match statement {
            S::Bind { names: bound, .. } => names.extend(bound.iter().cloned()),
            S::If { then_body, else_body, .. } => { declared_names(then_body, names); declared_names(else_body, names); }
            S::For { name, body, .. } => { names.insert(name.clone()); declared_names(body, names); }
            _ => {}
        }
    }
}
