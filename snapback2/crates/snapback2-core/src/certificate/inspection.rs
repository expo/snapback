//! Diagnostic analysis is available on refusal; only check_all grants admission.
// @ref LLP 1020#a4-check---cost — priced terms and refusals share the analyzer.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostTerm {
    pub meter: String,
    #[serde(with = "term_integer")]
    pub value: i128,
    pub source: String,
    pub site: Option<String>,
}

pub struct CheckAnalysis {
    pub certificate: Option<Certificate>,
    pub errors: Vec<CheckError>,
}
impl CheckAnalysis {
    pub(crate) fn admitted(self) -> Result<Certificate, Vec<CheckError>> {
        if self.errors.is_empty() { Ok(self.certificate.expect("successful analysis")) }
        else { Err(self.errors) }
    }
}
impl Checker<'_> {
    pub fn check_all(&self, program: &Program) -> Result<Certificate, Vec<CheckError>> {
        self.inspect(program).admitted()
    }
    pub fn inspect(&self, program: &Program) -> CheckAnalysis {
        let mut errors: Vec<_> = program
            .args
            .iter()
            .chain(self.schema.channels.values().flat_map(|c| c.args.iter()))
            .filter(|(_, kind)| !kind.bounds_valid())
            .map(|(name, _)| CheckError {
                site: Some(name.clone()),
                code: "E_INPUT".into(),
                message: "text min exceeds max".into(),
                rewrite: "use a text minimum no greater than its maximum".into(),
            })
            .collect();
        if program.read_time_granularity_ms.is_some_and(|g| {
            program.kind != ProgramKind::Query || g == 0 || g > crate::value::I53_MAX as u64
        }) {
            errors.push(CheckError {
                site: None,
                code: "E_INPUT".into(),
                message: "invalid query clock declaration".into(),
                rewrite: "declare a positive safe-integer readTime granularity on a query".into(),
            });
        }
        fn contains_check(body: &[Stmt]) -> bool { body.iter().any(|stmt| match stmt {
            Stmt::Check { .. } => true,
            Stmt::If { then_body, else_body, .. } => contains_check(then_body) || contains_check(else_body),
            Stmt::For { body, .. } => contains_check(body), _ => false,
        }) }
        if program.kind == ProgramKind::Query && contains_check(&program.body) {
            errors.push(CheckError { site: None, code: "E_OP_KIND".into(),
                message: "conditional writes require a mutation".into(), rewrite: "use a mutation for update ... if".into() });
        }
        if !errors.is_empty() { return CheckAnalysis { certificate: None, errors }; }

        if program.kind == ProgramKind::Job {
            return crate::jobs::inspect(self.schema, program, &self.ceilings);
        }
        let (mut errors, complete) = self.structural_errors(program);
        errors.extend(search::validate(self.schema, program));
        let certificate = match self.analyze(program) {
            Ok((mut certificate, mut analysis_errors)) => {
                errors.append(&mut analysis_errors);
                for site in &mut certificate.read_sites {
                    site.complete = complete.contains(&site.site);
                }
                Some(certificate)
            }
            Err(mut analysis_errors) => {
                errors.append(&mut analysis_errors);
                None
            }
        };
        CheckAnalysis { certificate, errors }
    }
}

// Serde's flattened-certificate buffer supports i64/u64 visitors, not i128.
// Saturated negative encoding adjustments beyond i64 retain exact decimal text.
mod term_integer {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &i128, serializer: S) -> Result<S::Ok, S::Error> {
        if let Ok(value) = u64::try_from(*value) { serializer.serialize_u64(value) }
        else if let Ok(value) = i64::try_from(*value) { serializer.serialize_i64(value) }
        else { serializer.serialize_str(&value.to_string()) }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i128, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        value.as_i64().map(i128::from).or_else(|| value.as_u64().map(i128::from))
            .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
            .ok_or_else(|| serde::de::Error::custom("cost term is not an exact integer"))
    }
}
