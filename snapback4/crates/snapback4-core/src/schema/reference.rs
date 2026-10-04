use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleTerm {
    /// One authorized point read through a row-local typed reference.
    Reference { table: String, column: String, field: String, old: bool },
    Field(String),
    OldField(String),
    NextField(String),
    Viewer,
    Literal(Value),
}


impl RuleExpr {
    pub fn has_reference(&self) -> bool {
        let term = |t: &RuleTerm| matches!(t, RuleTerm::Reference { .. });
        match self {
            Self::Eq(a,b) | Self::Ne(a,b) | Self::Compare(_,a,b) => term(a) || term(b),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_,t)|t)).any(term),
            Self::And(rs) | Self::Or(rs) => rs.iter().any(Self::has_reference),
            Self::Not(r) => r.has_reference(),
            _ => false,
        }
    }
}

pub(super) fn validate(schema: &Schema, source: &Table, term: &RuleTerm, update: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    let RuleTerm::Reference { table, column, field, old } = term else { return; };
    let valid = !path.ends_with(".read") && (!old || update) && schema.maintain_for(table).is_none()
        && matches!(source.columns.get(column).map(ColumnType::required), Some(ColumnType::Ref { table: t }) if t == table)
        && !source.written_by.get(column).is_some_and(|a| !a.audience)
        && schema.table(table).is_some_and(|t| t.ephemeral.is_none() && t.columns.contains_key(field)
            && !t.maintained.contains_key(field) && !t.written_by.get(field).is_some_and(|a| !a.audience));
    if !valid { issues.push(SchemaIssue { path: path.into(), message: "E_QUARRY_RULE_HOP: a write rule needs one ordinary reference and an audience-readable target field; use read through for inherited reads".into() }); }
}

pub(super) fn validate_term(schema: &Schema, table: &Table, term: &RuleTerm, update: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    match term {
        RuleTerm::Field(field) => {
            if !table.columns.contains_key(field) {
                issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule reads undeclared column {field}") });
            }
        }
        RuleTerm::OldField(field) | RuleTerm::NextField(field) => {
            if !update {
                issues.push(SchemaIssue { path: path.to_owned(), message: "old and next images exist only in update rules".into() });
            } else if !table.columns.contains_key(field) {
                issues.push(SchemaIssue { path: path.to_owned(), message: format!("rule reads undeclared column {field}") });
            }
        }
        RuleTerm::Reference { .. } => validate(schema, table, term, update, path, issues),
        RuleTerm::Viewer | RuleTerm::Literal(_) => {}
    }
}
