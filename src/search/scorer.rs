use crate::search::types::{SearchIndexManifestV1, SearchMatchAtomV1, SearchToken};
use std::collections::BTreeMap;

pub fn phrase_frequency(tokens: &[&SearchToken], terms: &[String]) -> u32 {
    if terms.is_empty() {
        return 0;
    }
    tokens
        .windows(terms.len())
        .filter(|window| {
            window
                .iter()
                .zip(terms)
                .enumerate()
                .all(|(index, (token, term))| {
                    token.token == *term
                        && (index == 0
                            || token.position == window[index - 1].position.saturating_add(1))
                })
        })
        .count() as u32
}

pub fn atom_frequency(atom: &SearchMatchAtomV1, terms: &[String], tokens: &[&SearchToken]) -> u32 {
    match atom {
        SearchMatchAtomV1::Term(_) => tokens
            .iter()
            .filter(|token| token.token == terms[0])
            .count() as u32,
        SearchMatchAtomV1::Prefix(_) => tokens
            .iter()
            .filter(|token| token.token.starts_with(&terms[0]))
            .count() as u32,
        SearchMatchAtomV1::Phrase(_) => phrase_frequency(tokens, terms),
    }
}

pub fn atom_score(
    index: &SearchIndexManifestV1,
    atom: &SearchMatchAtomV1,
    terms: &[String],
    tokens: &[SearchToken],
) -> u32 {
    let mut by_field = BTreeMap::<&str, Vec<&SearchToken>>::new();
    for token in tokens {
        by_field.entry(&token.field).or_default().push(token);
    }
    let field_constraint = match atom {
        SearchMatchAtomV1::Term(value) | SearchMatchAtomV1::Prefix(value) => value.field.as_deref(),
        SearchMatchAtomV1::Phrase(value) => value.field.as_deref(),
    };
    let mut total = 0_u32;
    for (field, spec) in &index.text_fields {
        if field_constraint.is_some_and(|constraint| constraint != field) {
            continue;
        }
        let field_tokens = by_field.get(field.as_str()).cloned().unwrap_or_default();
        let frequency = atom_frequency(atom, terms, &field_tokens);
        let contribution = match atom {
            SearchMatchAtomV1::Term(_) => spec.weight * frequency.min(8) * 100,
            SearchMatchAtomV1::Prefix(_) => spec.weight * frequency.min(8) * 80,
            SearchMatchAtomV1::Phrase(_) => spec.weight * frequency.min(4) * 250,
        };
        total = total
            .checked_add(contribution)
            .expect("declared score bound");
        if !matches!(atom, SearchMatchAtomV1::Prefix(_))
            && field_tokens.len() == terms.len()
            && field_tokens
                .iter()
                .map(|token| token.token.as_str())
                .eq(terms.iter().map(String::as_str))
        {
            total = total
                .checked_add(spec.weight * 400)
                .expect("declared score bound");
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::analyzer::analyze_field;
    use crate::search::types::*;

    #[test]
    fn integer_score_is_exact_and_phrase_positions_do_not_bridge() {
        let index = SearchIndexManifestV1 {
            format_version: 1,
            name: "i".into(),
            semantic_version: "1".into(),
            analyzer: SEARCH_ANALYZER.into(),
            analyzer_tables_digest: "x".into(),
            text_fields: BTreeMap::from([(
                "body".into(),
                SearchTextFieldV1 {
                    weight: 2,
                    classification: SearchFieldClassV1::Public,
                },
            )]),
            field_classifications: BTreeMap::new(),
            equality_filters: vec![],
            stored_fields: vec![],
            highlight_fields: vec![],
            visibility: SearchVisibilityV1::PublicRead,
            tie_break: "score-desc-row-id-asc.v1".into(),
            source_limits: Default::default(),
            query_limits: Default::default(),
            cursor_limits: Default::default(),
            maintenance_limits: Default::default(),
            live_limits: None,
        };
        let tokens = analyze_field("body", "api api latency").unwrap();
        assert_eq!(
            atom_score(
                &index,
                &SearchMatchAtomV1::Term(SearchTermV1 {
                    value: "api".into(),
                    field: None
                }),
                &["api".into()],
                &tokens
            ),
            400
        );
        assert_eq!(
            phrase_frequency(
                &tokens.iter().collect::<Vec<_>>(),
                &["api".into(), "latency".into()]
            ),
            1
        );
    }
}
