use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::search::analyzer::analyze_atom;
use crate::search::types::*;
use serde_json::Value;
use std::collections::BTreeSet;

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_SEARCH_QUERY_INVALID", "search", message)
}

fn atom_key(atom: &SearchMatchAtomV1) -> SnapbackResult<String> {
    crate::rqs_contract::sha256_identity(
        &serde_json::to_value(atom).map_err(|_| invalid("query atom does not serialize"))?,
    )
    .map_err(|_| invalid("query atom is not canonicalizable"))
}

pub fn canonical_atom_bytes(atom: &SearchMatchAtomV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(atom).map_err(|_| invalid("query atom does not serialize"))?;
    crate::rqs_contract::jcs(&value).map_err(|_| invalid("query atom is not canonicalizable"))
}

fn sort_and_dedupe<T>(pairs: &mut Vec<(String, T)>) {
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    pairs.dedup_by(|a, b| a.0 == b.0);
}

fn validate_field(index: &SearchIndexManifestV1, field: &Option<String>) -> SnapbackResult<()> {
    if let Some(field) = field
        && !index.text_fields.contains_key(field)
    {
        return Err(invalid(format!(
            "query references undeclared search field {field}"
        )));
    }
    Ok(())
}

fn validate_atom(
    index: &SearchIndexManifestV1,
    atom: &SearchMatchAtomV1,
    prefixes: &mut usize,
) -> SnapbackResult<()> {
    match atom {
        SearchMatchAtomV1::Term(term) => {
            validate_field(index, &term.field)?;
            if analyze_atom(&term.value)?.len() != 1 {
                return Err(invalid("term must analyze to exactly one token"));
            }
        }
        SearchMatchAtomV1::Prefix(prefix) => {
            validate_field(index, &prefix.field)?;
            let tokens = analyze_atom(&prefix.value)?;
            if tokens.len() != 1
                || tokens[0].chars().count() < index.query_limits.min_prefix_scalars as usize
            {
                return Err(invalid(
                    "prefix must analyze to one token at or above minPrefixScalars",
                ));
            }
            *prefixes += 1;
        }
        SearchMatchAtomV1::Phrase(phrase) => {
            validate_field(index, &phrase.field)?;
            let mut count = 0;
            for input in &phrase.values {
                count += analyze_atom(input)?.len();
            }
            if !(1..=16).contains(&count) {
                return Err(invalid("phrase must analyze to 1..16 tokens"));
            }
        }
    }
    Ok(())
}

pub fn validate_query(
    index: &SearchIndexManifestV1,
    query: &SearchQueryAstV1,
) -> SnapbackResult<()> {
    let mut positive = 0;
    let mut excluded = 0;
    let mut filters = 0;
    let mut prefixes = 0;
    let mut has_any = false;
    for clause in &query.all {
        match clause {
            SearchClauseV1::Term(term) => {
                validate_atom(index, &SearchMatchAtomV1::Term(term.clone()), &mut prefixes)?;
                positive += 1;
            }
            SearchClauseV1::Phrase(phrase) => {
                validate_atom(
                    index,
                    &SearchMatchAtomV1::Phrase(phrase.clone()),
                    &mut prefixes,
                )?;
                positive += 1;
            }
            SearchClauseV1::Prefix(prefix) => {
                validate_atom(
                    index,
                    &SearchMatchAtomV1::Prefix(prefix.clone()),
                    &mut prefixes,
                )?;
                positive += 1;
            }
            SearchClauseV1::Any(atoms) => {
                if has_any || atoms.is_empty() {
                    return Err(invalid("query admits exactly one nonempty flat any clause"));
                }
                has_any = true;
                for atom in atoms {
                    validate_atom(index, atom, &mut prefixes)?;
                }
                positive += atoms.len();
            }
            SearchClauseV1::Not(atom) => {
                validate_atom(index, atom, &mut prefixes)?;
                excluded += 1;
            }
            SearchClauseV1::Filter(filter) => {
                // The grammar (SearchFilterOpV1 / SearchFilterValueV1) already
                // closed op and value at deserialization; the declared-field
                // membership stays a semantic check against the index.
                if filter.op != SearchFilterOpV1::Eq
                    || !index.equality_filters.contains(&filter.field)
                {
                    return Err(invalid("filter must be declared non-null equality"));
                }
                filters += 1;
            }
        }
    }
    if !(1..=16).contains(&positive) || excluded > 8 || filters > 8 || prefixes > 1 {
        return Err(invalid(
            "query exceeds the positive/exclusion/filter/prefix shape bounds",
        ));
    }
    Ok(())
}

pub fn atom_tokens(atom: &SearchMatchAtomV1) -> SnapbackResult<Vec<String>> {
    match atom {
        SearchMatchAtomV1::Term(term) | SearchMatchAtomV1::Prefix(term) => {
            analyze_atom(&term.value)
        }
        SearchMatchAtomV1::Phrase(phrase) => {
            let mut tokens = Vec::new();
            for input in &phrase.values {
                tokens.extend(analyze_atom(input)?);
            }
            Ok(tokens)
        }
    }
}

pub fn clause_atom(clause: &SearchClauseV1) -> Option<SearchMatchAtomV1> {
    match clause {
        SearchClauseV1::Term(value) => Some(SearchMatchAtomV1::Term(value.clone())),
        SearchClauseV1::Phrase(value) => Some(SearchMatchAtomV1::Phrase(value.clone())),
        SearchClauseV1::Prefix(value) => Some(SearchMatchAtomV1::Prefix(value.clone())),
        _ => None,
    }
}

pub fn canonicalize_query(
    index: &SearchIndexManifestV1,
    query: SearchQueryAstV1,
) -> SnapbackResult<SearchQueryAstV1> {
    validate_query(index, &query)?;
    let mut positive = Vec::<(String, SearchClauseV1)>::new();
    let mut any = Vec::<(String, SearchMatchAtomV1)>::new();
    let mut excluded = Vec::<(String, SearchMatchAtomV1)>::new();
    let mut filters = Vec::<(String, SearchFilterV1)>::new();
    for clause in query.all {
        match clause {
            SearchClauseV1::Any(atoms) => {
                for atom in atoms {
                    any.push((atom_key(&atom)?, atom));
                }
            }
            SearchClauseV1::Not(atom) => excluded.push((atom_key(&atom)?, atom)),
            SearchClauseV1::Filter(filter) => {
                let key = crate::rqs_contract::sha256_identity(
                    &serde_json::to_value(&filter)
                        .map_err(|_| invalid("filter does not serialize"))?,
                )
                .map_err(|_| invalid("filter is not canonicalizable"))?;
                filters.push((key, filter));
            }
            clause => {
                let atom = clause_atom(&clause).expect("positive clause");
                positive.push((atom_key(&atom)?, clause));
            }
        }
    }
    sort_and_dedupe(&mut positive);
    sort_and_dedupe(&mut any);
    sort_and_dedupe(&mut excluded);
    sort_and_dedupe(&mut filters);
    let positive_keys = positive.iter().map(|(key, _)| key).collect::<BTreeSet<_>>();
    any.retain(|(key, _)| !positive_keys.contains(key));
    if excluded
        .iter()
        .any(|(key, _)| positive_keys.contains(key) || any.iter().any(|(other, _)| other == key))
    {
        return Err(invalid("the same atom cannot be positive and excluded"));
    }
    let mut all = positive
        .into_iter()
        .map(|(_, clause)| clause)
        .collect::<Vec<_>>();
    if !any.is_empty() {
        all.push(SearchClauseV1::Any(
            any.into_iter().map(|(_, atom)| atom).collect(),
        ));
    }
    all.extend(
        excluded
            .into_iter()
            .map(|(_, atom)| SearchClauseV1::Not(atom)),
    );
    all.extend(
        filters
            .into_iter()
            .map(|(_, filter)| SearchClauseV1::Filter(filter)),
    );
    let canonical = SearchQueryAstV1 { all };
    validate_query(index, &canonical)?;
    Ok(canonical)
}

pub fn query_core_hash(query: &SearchQueryAstV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(query).map_err(|_| invalid("query does not serialize"))?;
    crate::rqs_contract::sha256_identity(&Value::Array(vec![
        Value::String("snapback:search-query-core:v1".to_owned()),
        value,
    ]))
    .map_err(|_| invalid("query is not canonicalizable"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn manifest() -> SearchIndexManifestV1 {
        SearchIndexManifestV1 {
            format_version: 1,
            name: "idx".into(),
            semantic_version: "v1".into(),
            analyzer: SEARCH_ANALYZER.into(),
            analyzer_tables_digest: crate::search::unicode17_generated::ANALYZER_TABLES_DIGEST
                .into(),
            text_fields: BTreeMap::from([(
                "body".into(),
                SearchTextFieldV1 {
                    weight: 1,
                    classification: SearchFieldClassV1::Public,
                },
            )]),
            field_classifications: BTreeMap::from([("status".into(), SearchFieldClassV1::Public)]),
            equality_filters: vec!["status".into()],
            stored_fields: vec![],
            highlight_fields: vec![],
            visibility: SearchVisibilityV1::PublicRead,
            tie_break: "score-desc-row-id-asc.v1".into(),
            source_limits: Default::default(),
            query_limits: Default::default(),
            cursor_limits: Default::default(),
            maintenance_limits: Default::default(),
            live_limits: None,
        }
    }

    #[test]
    fn canonicalization_is_permutation_and_duplicate_invariant() {
        let term = SearchClauseV1::Term(SearchTermV1 {
            value: "Hello".into(),
            field: None,
        });
        let a = canonicalize_query(
            &manifest(),
            SearchQueryAstV1 {
                all: vec![term.clone(), term.clone()],
            },
        )
        .unwrap();
        let b = canonicalize_query(&manifest(), SearchQueryAstV1 { all: vec![term] }).unwrap();
        assert_eq!(query_core_hash(&a).unwrap(), query_core_hash(&b).unwrap());
    }
}
