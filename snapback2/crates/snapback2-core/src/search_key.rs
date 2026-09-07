//! Active index expressions and source descriptors.
//! Wire descriptors intentionally have no Eq/Ord/Hash: compare their normalized meanings here.
// @ref LLP 1001#unicode-search-foundation — source descriptors compare by normalized meaning, with independent Q.
use crate::{
    Value,
    ir::Expr,
    unicode::{SearchInputError, SearchNormalizer, search_query_token},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SearchContract {
    #[serde(rename = "u17-nfc-scf-nfc-wsp-p")]
    Unicode17,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum IndexComponent {
    Column(String),
    WordPrefixes {
        fields: Vec<String>,
        contract: SearchContract,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum IndexKeyExpr<E = Expr> {
    Scalar(E),
    WordPrefix {
        source: E,
        contract: SearchContract,
        source_max: usize,
    },
}

impl<E> IndexKeyExpr<E> {
    pub fn expression(&self) -> &E {
        match self {
            Self::Scalar(value) | Self::WordPrefix { source: value, .. } => value,
        }
    }
    pub fn scalar(&self) -> Option<&E> {
        match self {
            Self::Scalar(value) => Some(value),
            _ => None,
        }
    }
}

impl<E> From<E> for IndexKeyExpr<E> {
    fn from(value: E) -> Self {
        Self::Scalar(value)
    }
}

impl IndexComponent {
    pub fn column(&self) -> Option<&String> {
        match self {
            Self::Column(name) => Some(name),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WordPrefix {
    pub contract: SearchContract,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum IndexAtom {
    Scalar(Value),
    WordPrefix(WordPrefix),
}

/// An execution-local comparison value, never serialized or used as an application Value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum LogicalIndexAtom {
    Scalar(Value),
    WordPrefix(NormalizedWordPrefix),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedWordPrefix(Option<std::sync::Arc<str>>);
impl Serialize for NormalizedWordPrefix {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.token().serialize(s)
    }
}
impl NormalizedWordPrefix {
    pub(crate) fn prepare(
        source: &str,
        q: usize,
    ) -> Result<(Self, usize, usize), SearchInputError> {
        let (token, steps, scratch) = crate::unicode::search_query_token_metered(
            source,
            q,
            &mut SearchNormalizer::default(),
        )?;
        Ok((Self(token.map(Into::into)), steps, scratch))
    }
    pub fn token(&self) -> Option<&str> {
        self.0.as_deref()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_none()
    }
    /// `word` must already be a token from this pinned normalizer. Empty search matches nothing.
    pub fn matches_normalized_word(&self, word: &str) -> bool {
        self.0
            .as_ref()
            .is_some_and(|token| word.starts_with(token.as_ref()))
    }
}

/// source_max is the issuing operation's Q, never a number admitted from a wire atom or field max.
/// The downstream slot validator still checks ordinary ColumnType/optionality and index shape.
pub fn prepare_index_atom(
    component: &IndexComponent,
    atom: &IndexAtom,
    source_max: Option<usize>,
    normalizer: &mut SearchNormalizer,
) -> Result<LogicalIndexAtom, SearchInputError> {
    match (component, atom) {
        (IndexComponent::Column(_), IndexAtom::Scalar(value)) => {
            let valid = match value {
                Value::Null
                | Value::Bool(_)
                | Value::String(_)
                | Value::Id(_)
                | Value::Bytes(_) => true,
                Value::Int(n) => (crate::value::I53_MIN..=crate::value::I53_MAX).contains(n),
                _ => false,
            };
            if !valid {
                return Err(SearchInputError("expected scalar index value"));
            }
            Ok(LogicalIndexAtom::Scalar(value.clone()))
        }
        (IndexComponent::WordPrefixes { contract, .. }, IndexAtom::WordPrefix(prefix))
            if *contract == prefix.contract =>
        {
            let q = source_max.ok_or(SearchInputError(
                "search source bound must come from the issuing operation",
            ))?;
            Ok(LogicalIndexAtom::WordPrefix(NormalizedWordPrefix(
                search_query_token(&prefix.source, q, normalizer)?.map(Into::into),
            )))
        }
        _ => Err(SearchInputError(
            "index atom does not match its declared component",
        )),
    }
}

pub fn decode_index_atom(
    json: &str,
    component: &IndexComponent,
    source_max: Option<usize>,
    normalizer: &mut SearchNormalizer,
) -> Result<(IndexAtom, LogicalIndexAtom), SearchInputError> {
    if matches!(component, IndexComponent::WordPrefixes { .. }) {
        let q = source_max.ok_or(SearchInputError(
            "search source bound must come from the issuing operation",
        ))?;
        if json.len() > word_prefix_wire_max(q)? {
            return Err(SearchInputError(
                "index atom exceeds its declared byte bound",
            ));
        }
    }
    let atom: IndexAtom = serde_json::from_str(json)
        .map_err(|_| SearchInputError("invalid index atom descriptor"))?;
    // Match the existing cursor's decode/re-encode convention. This also refuses
    // duplicate JSON fields identically to JS without adding another JSON parser.
    if serde_json::to_string(&atom)
        .map_err(|_| SearchInputError("invalid index atom descriptor"))?
        != json
    {
        return Err(SearchInputError("index atom is not canonical tagged JSON"));
    }
    let logical = prepare_index_atom(component, &atom, source_max, normalizer)?;
    Ok((atom, logical))
}

pub fn word_prefix_wire_max(source_max: usize) -> Result<usize, SearchInputError> {
    crate::unicode::scalar_length("", source_max)?;
    source_max
        .checked_mul(4)
        .and_then(|n| n.checked_add(63))
        .ok_or(SearchInputError("invalid search source bound"))
}

pub fn index_keys_equal(left: &[LogicalIndexAtom], right: &[LogicalIndexAtom]) -> bool {
    left == right
}

/// Tuple-prefix containment uses equality at every occupied slot, including the whole search token.
/// A receipt for term `ca` cannot cover term `cat`, although both may match the same source word.
pub fn index_key_starts_with(key: &[LogicalIndexAtom], prefix: &[LogicalIndexAtom]) -> bool {
    key.starts_with(prefix)
}

/// Ordering belongs only to ordinary suffix components. No generic ordering for derived atoms.
pub fn compare_scalar_atoms(
    left: &LogicalIndexAtom,
    right: &LogicalIndexAtom,
) -> Result<std::cmp::Ordering, SearchInputError> {
    match (left, right) {
        (LogicalIndexAtom::Scalar(a), LogicalIndexAtom::Scalar(b)) => Ok(a.total_cmp(b)),
        _ => Err(SearchInputError("word-prefix atoms admit equality only")),
    }
}

/// Exact ordinary touches are one-sided. A derived predicate is never an ordinary point.
pub fn scalar_key_starts_with(key: &[Value], prefix: &[IndexAtom]) -> bool {
    key.len() >= prefix.len()
        && key
            .iter()
            .zip(prefix)
            .all(|(a, b)| matches!(b, IndexAtom::Scalar(v) if a==v))
}
/// Source scopes invalidate every deeper term range; no term normalization is needed here.
pub fn scope_intersects(scope: &[Value], range: &[IndexAtom]) -> bool {
    scope
        .iter()
        .zip(range)
        .all(|(a, b)| matches!(b, IndexAtom::Scalar(v) if a==v))
}

/// Q is recovered from one issuing site in a trusted operation, never supplied by receipt data.
pub fn prepare_receipt_prefix(
    schema: &crate::Schema,
    program: &crate::ir::Program,
    site: &str,
    table: &str,
    index: &str,
    atoms: &[IndexAtom],
) -> Result<Vec<LogicalIndexAtom>, SearchInputError> {
    let definition = schema
        .table(table)
        .and_then(|t| t.index(index))
        .ok_or(SearchInputError("unknown receipt index"))?;
    if atoms.len() > definition.components.len() {
        return Err(SearchInputError("invalid receipt prefix arity"));
    }
    let mut issuers = Vec::new();
    fn walk(body: &[crate::ir::Stmt], site: &str, out: &mut Vec<crate::ir::Scan>) {
        for stmt in body {
            crate::certificate_policy::visit_statement_exprs(stmt, &mut |e| {
                if let Expr::Scan(scan) = e {
                    if scan.site == site {
                        out.push(scan.clone())
                    }
                }
            });
            match stmt {
                crate::ir::Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    walk(then_body, site, out);
                    walk(else_body, site, out)
                }
                crate::ir::Stmt::For { body, .. } => walk(body, site, out),
                _ => {}
            }
        }
    }
    if definition.derived_offset().is_some() {
        walk(&program.body, site, &mut issuers);
        if issuers.len() != 1
            || issuers[0].table != table
            || issuers[0].index != index
            || issuers[0].prefix.len() != atoms.len()
        {
            return Err(SearchInputError(
                "receipt needs its unique trusted issuing read site",
            ));
        }
    }
    let mut normalizer = SearchNormalizer::default();
    definition
        .components
        .iter()
        .zip(atoms)
        .enumerate()
        .map(|(offset, (c, a))| {
            let q = issuers
                .first()
                .and_then(|s| s.prefix.get(offset))
                .and_then(|k| match k {
                    IndexKeyExpr::WordPrefix { source_max, .. } => Some(*source_max),
                    _ => None,
                });
            if let (IndexComponent::Column(column), IndexAtom::Scalar(value)) = (c, a) {
                let kind = &schema.table(table).unwrap().columns[column];
                crate::engine::validate_column_value(table, column, kind, Some(value))
                    .map_err(|_| SearchInputError("invalid scalar receipt prefix"))?;
            }
            prepare_index_atom(c, a, q, &mut normalizer)
        })
        .collect()
}
