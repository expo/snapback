use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleTerm {
    /// One authorized point read through a row-local typed reference.
    Reference { table: String, column: String, field: String, old: bool },
    /// Bounded live reads; a distinct variant makes old decoders refuse.
    ReferenceChain { column: String, hops: Vec<RuleHop>, old: bool },
    Field(String),
    OldField(String),
    NextField(String),
    Viewer,
    Literal(Value),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleHop { pub table: String, pub field: String }

pub const MAX_RULE_HOPS: usize = 3;

impl RuleTerm {
    pub fn reference_source(&self) -> Option<(&str, bool)> {
        match self {
            Self::Reference { column, old, .. } | Self::ReferenceChain { column, old, .. } => Some((column, *old)),
            _ => None,
        }
    }
    pub fn references(&self) -> impl Iterator<Item = (&str, &str)> {
        let (one, many) = match self {
            Self::Reference { table, field, .. } => (Some((table.as_str(), field.as_str())), &[][..]),
            Self::ReferenceChain { hops, .. } => (None, hops.as_slice()),
            _ => (None, &[][..]),
        };
        one.into_iter().chain(many.iter().map(|hop| (hop.table.as_str(), hop.field.as_str())))
    }
}

impl RuleExpr {
    pub fn has_reference(&self) -> bool {
        self.any_term(&|t| t.reference_source().is_some())
    }
    pub fn any_term(&self, term: &impl Fn(&RuleTerm) -> bool) -> bool {
        match self {
            Self::Eq(a,b) | Self::Ne(a,b) | Self::Compare(_,a,b) => term(a) || term(b),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_,t)|t)).any(term),
            Self::And(rs) | Self::Or(rs) => rs.iter().any(|r| r.any_term(term)),
            Self::Not(r) => r.any_term(term),
            _ => false,
        }
    }
}

pub(super) fn validate(schema: &Schema, source: &Table, term: &RuleTerm, update: bool, path: &str, issues: &mut Vec<SchemaIssue>) {
    let Some((column, old)) = term.reference_source() else { return; };
    let depth = term.references().count();
    let mut valid = !path.ends_with(".read") && (!old || update) && (1..=MAX_RULE_HOPS).contains(&depth)
        && !matches!(term, RuleTerm::ReferenceChain { .. } if depth < 2);
    let (mut owner, mut column) = (source, column);
    for (table, field) in term.references() {
        valid &= schema.maintain_for(table).is_none()
            && matches!(owner.columns.get(column).map(ColumnType::required), Some(ColumnType::Ref { table: t }) if t == table)
            && !owner.maintained.contains_key(column) && !owner.written_by.get(column).is_some_and(|a| !a.audience);
        let Some(target) = schema.table(table) else { valid = false; break; };
        valid &= target.ephemeral.is_none() && target.columns.contains_key(field)
            && !target.maintained.contains_key(field) && !target.written_by.get(field).is_some_and(|a| !a.audience);
        owner = target; column = field;
    }
    if !valid { issues.push(SchemaIssue { path: path.into(), message: "E_QUARRY_RULE_HOP: write rules allow up to three ordinary live references with audience-readable fields; use authorized mutation reads for other paths".into() }); }
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
        RuleTerm::Reference { .. } | RuleTerm::ReferenceChain { .. } => validate(schema, table, term, update, path, issues),
        RuleTerm::Viewer | RuleTerm::Literal(_) => {}
    }
}
