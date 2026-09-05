//! Whole-program writes, independent of reachability or interpreter exits.
// @ref LLP 1017#32-the-rule — repeated/nested assignments cannot establish a page.
use super::*;

#[derive(Default)]
pub(super) struct Binding {
    writes: usize,
    pushes: usize,
    top: bool,
    empty_declaration: bool,
}

impl Binding {
    pub(super) fn single_top(&self) -> bool {
        self.writes == 1 && self.top && self.pushes == 0
    }
    pub(super) fn head_only(&self) -> bool {
        self.writes == 1 && self.pushes == 0
    }
    pub(super) fn collector(&self) -> bool {
        self.writes == 1 && self.top && self.empty_declaration && self.pushes == 1
    }
}

pub(super) fn collect(body: &[Stmt], top: bool, out: &mut BTreeMap<String, Binding>) {
    for stmt in body {
        match stmt {
            Stmt::Let { name, value }
            | Stmt::Const { name, value }
            | Stmt::Assign { name, value } => {
                let fact = out.entry(name.clone()).or_default();
                fact.writes += 1;
                fact.top = top;
                fact.empty_declaration = !matches!(stmt, Stmt::Assign { .. })
                    && match value {
                        Expr::Array(v) => v.is_empty(),
                        Expr::Literal(Value::Array(v)) => v.is_empty(),
                        _ => false,
                    };
            }
            Stmt::Push { target, .. } => out.entry(target.clone()).or_default().pushes += 1,
            Stmt::For { binding, body, .. } => {
                out.entry(binding.clone()).or_default().writes += 1;
                collect(body, false, out);
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                collect(then_body, false, out);
                collect(else_body, false, out);
            }
            _ => {}
        }
    }
}

pub(super) fn capped_writes(schema: &Schema, body: &[Stmt], out: &mut BTreeSet<String>) {
    for stmt in body {
        match stmt {
            Stmt::Insert { table, .. }
            | Stmt::Update { table, .. }
            | Stmt::Upsert { table, .. }
            | Stmt::Delete { table, .. } => {
                if schema.table(table).is_some_and(|t| {
                    t.constraints
                        .iter()
                        .any(|c| matches!(c, Constraint::Cap { .. }))
                }) {
                    out.insert(table.clone());
                }
            }
            Stmt::For { body, .. } => capped_writes(schema, body, out),
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                capped_writes(schema, then_body, out);
                capped_writes(schema, else_body, out);
            }
            _ => {}
        }
    }
}
