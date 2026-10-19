//! Column disclosure in the surface-tree Lean emitter.
use super::*;

#[derive(Clone, Debug)]
pub(super) struct Col {
    pub(super) name: String,
    pub(super) kind: Kind,
    pub(super) nullable: bool,
    pub(super) protected: bool,
    /// A reference's effective delete action (LLP 3000.039 §2): the declared
    /// one, else restrict; `None` for `keep` and for a non-reference.
    pub(super) on_delete: Option<&'static str>,
}

pub(super) fn gates(t: &ast::TableDecl, shape: &Table, tables: &[Table]) -> R<Vec<Json>> {
    let ctx = RuleCtx {
        table: shape,
        tables,
    };
    let mut column_rules = Vec::new();
    for c in &t.columns {
        if let Some(gate) = &c.read {
            column_rules.push(json!([c.name, ctx.rule(gate, &Images::As("self"))?]));
        }
    }
    for (fields, rule) in &t.column_reads {
        for field in fields {
            column_rules.push(json!([field, ctx.rule(&rule.value, &Images::As("self"))?]));
        }
    }
    Ok(column_rules)
}
