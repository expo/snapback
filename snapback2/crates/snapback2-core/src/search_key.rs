//! Preparatory R2 contracts. NOT accepted by Schema::Index or the current IR.
//! Activate components, certificate/source bounds, identities, and every key consumer together.
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum IndexKeyExpr<E = Expr> {
    Scalar(E),
    WordPrefix {
        source: E,
        contract: SearchContract,
        source_max: usize,
    },
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LogicalIndexAtom {
    Scalar(Value),
    WordPrefix(NormalizedWordPrefix),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedWordPrefix(Option<String>);
impl NormalizedWordPrefix {
    pub fn token(&self) -> Option<&str> {
        self.0.as_deref()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_none()
    }
    /// `word` must already be a token from this pinned normalizer. Empty search matches nothing.
    pub fn matches_normalized_word(&self, word: &str) -> bool {
        self.0.as_ref().is_some_and(|token| word.starts_with(token))
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
                search_query_token(&prefix.source, q, normalizer)?,
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
