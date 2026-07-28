use crate::search::types::{SearchHighlightV1, SearchMatchRangeV1};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchOccurrence {
    pub field: String,
    pub source_start: u32,
    pub source_end: u32,
    pub canonical_atom: String,
}

/// Build at most three plain-text fragments. Source ranges are scalar offsets;
/// grapheme boundaries are used only to select/extract, so no client receives
/// split combining or emoji sequences.
///
/// @ref LLP 0073#highlights-and-private-data — bounded plain text and scalar
/// ranges, never backend-generated HTML.
pub fn highlights(
    field_order: &[String],
    source_fields: &std::collections::BTreeMap<String, String>,
    matched: &[SearchOccurrence],
) -> Vec<SearchHighlightV1> {
    let mut ordered = matched.to_vec();
    ordered.sort_by(|a, b| {
        let field_a = field_order
            .iter()
            .position(|field| field == &a.field)
            .unwrap_or(usize::MAX);
        let field_b = field_order
            .iter()
            .position(|field| field == &b.field)
            .unwrap_or(usize::MAX);
        field_a
            .cmp(&field_b)
            .then(a.source_start.cmp(&b.source_start))
            .then(b.source_end.cmp(&a.source_end))
            .then(a.canonical_atom.as_bytes().cmp(b.canonical_atom.as_bytes()))
    });
    let mut merged = Vec::<SearchOccurrence>::new();
    for occurrence in ordered {
        if let Some(previous) = merged.last_mut()
            && previous.field == occurrence.field
            && occurrence.source_start <= previous.source_end
        {
            previous.source_end = previous.source_end.max(occurrence.source_end);
            continue;
        }
        merged.push(occurrence);
    }
    let mut result = Vec::new();
    let mut occurrence_index = 0;
    while occurrence_index < merged.len() {
        if result.len() >= 3 {
            break;
        }
        let occurrence = &merged[occurrence_index];
        occurrence_index += 1;
        let Some(source) = source_fields.get(&occurrence.field) else {
            continue;
        };
        let graphemes = UnicodeSegmentation::grapheme_indices(source.as_str(), true)
            .map(|(byte, grapheme)| {
                let scalar_start = source[..byte].chars().count() as u32;
                let scalar_end = scalar_start + grapheme.chars().count() as u32;
                (byte, byte + grapheme.len(), scalar_start, scalar_end)
            })
            .collect::<Vec<_>>();
        let Some(first) = graphemes
            .iter()
            .position(|(_, _, _, end)| *end > occurrence.source_start)
        else {
            continue;
        };
        let Some(last) = graphemes
            .iter()
            .rposition(|(_, _, start, _)| *start < occurrence.source_end)
        else {
            continue;
        };
        let mut left = first;
        let mut right = last;
        loop {
            let before = left.checked_sub(1);
            let after = (right + 1 < graphemes.len()).then_some(right + 1);
            let mut changed = false;
            for candidate in [before.map(|v| (true, v)), after.map(|v| (false, v))]
                .into_iter()
                .flatten()
            {
                let (on_left, index) = candidate;
                let next_left = if on_left { index } else { left };
                let next_right = if on_left { right } else { index };
                let bytes = graphemes[next_right].1 - graphemes[next_left].0;
                let within_context = if on_left {
                    occurrence.source_start.saturating_sub(graphemes[index].2) <= 48
                } else {
                    graphemes[index].3.saturating_sub(occurrence.source_end) <= 48
                };
                if bytes <= 256 && within_context {
                    left = next_left;
                    right = next_right;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        let byte_start = graphemes[left].0;
        let byte_end = graphemes[right].1;
        if byte_end - byte_start > 256 {
            continue;
        }
        let scalar_base = graphemes[left].2;
        let scalar_end = graphemes[right].3;
        let mut matches = vec![SearchMatchRangeV1 {
            start: occurrence.source_start.saturating_sub(scalar_base),
            end: occurrence.source_end.saturating_sub(scalar_base),
        }];
        while occurrence_index < merged.len() && matches.len() < 8 {
            let candidate = &merged[occurrence_index];
            if candidate.field != occurrence.field
                || candidate.source_start < scalar_base
                || candidate.source_end > scalar_end
            {
                break;
            }
            matches.push(SearchMatchRangeV1 {
                start: candidate.source_start.saturating_sub(scalar_base),
                end: candidate.source_end.saturating_sub(scalar_base),
            });
            occurrence_index += 1;
        }
        result.push(SearchHighlightV1 {
            field: occurrence.field.clone(),
            text: source[byte_start..byte_end].to_owned(),
            matches,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::analyzer::analyze_field;
    use std::collections::BTreeMap;

    fn occurrence(token: &crate::search::types::SearchToken) -> SearchOccurrence {
        SearchOccurrence {
            field: token.field.clone(),
            source_start: token.source_start,
            source_end: token.source_end,
            canonical_atom: token.token.clone(),
        }
    }

    #[test]
    fn fragments_are_plain_bounded_and_grapheme_safe() {
        let source = "before e\u{301} match after";
        let tokens = analyze_field("body", source).unwrap();
        let hit = tokens.iter().find(|token| token.token == "match").unwrap();
        let out = highlights(
            &["body".into()],
            &BTreeMap::from([("body".into(), source.into())]),
            &[occurrence(hit)],
        );
        assert_eq!(out.len(), 1);
        assert!(out[0].text.len() <= 256);
        assert_eq!(out[0].matches.len(), 1);
    }

    #[test]
    fn overlapping_occurrences_and_hits_inside_one_fragment_merge() {
        let source = "alpha beta gamma delta";
        let out = highlights(
            &["body".into()],
            &BTreeMap::from([("body".into(), source.into())]),
            &[
                SearchOccurrence {
                    field: "body".into(),
                    source_start: 0,
                    source_end: 10,
                    canonical_atom: "phrase".into(),
                },
                SearchOccurrence {
                    field: "body".into(),
                    source_start: 6,
                    source_end: 10,
                    canonical_atom: "beta".into(),
                },
                SearchOccurrence {
                    field: "body".into(),
                    source_start: 11,
                    source_end: 16,
                    canonical_atom: "gamma".into(),
                },
            ],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].matches,
            vec![
                SearchMatchRangeV1 { start: 0, end: 10 },
                SearchMatchRangeV1 { start: 11, end: 16 },
            ]
        );
    }

    #[test]
    fn unicode_and_field_boundary_golden_vectors_are_exact() {
        let sources = BTreeMap::<String, String>::from([
            ("apostrophe".to_owned(), "don't stop".to_owned()),
            ("emoji".to_owned(), "👩‍🚀 alpha".to_owned()),
            ("hyphen".to_owned(), "alpha-beta".to_owned()),
            ("rtl".to_owned(), "שלום עולם".to_owned()),
        ]);
        let cases = [
            ("apostrophe", "don't"),
            ("emoji", "alpha"),
            ("hyphen", "beta"),
            ("rtl", "שלום"),
        ];
        let matched = cases
            .iter()
            .map(|(field, token)| {
                let tokens = analyze_field(field, &sources[*field]).unwrap();
                occurrence(tokens.iter().find(|value| value.token == *token).unwrap())
            })
            .collect::<Vec<_>>();
        let out = highlights(
            &[
                "apostrophe".into(),
                "emoji".into(),
                "hyphen".into(),
                "rtl".into(),
            ],
            &sources,
            &matched,
        );
        assert_eq!(out.len(), 3, "the global fragment cap is deterministic");
        assert_eq!(out[0].field, "apostrophe");
        assert_eq!(out[0].text, "don't stop");
        assert_eq!(
            out[0].matches,
            vec![SearchMatchRangeV1 { start: 0, end: 5 }]
        );
        assert_eq!(out[1].field, "emoji");
        assert_eq!(out[1].text, "👩‍🚀 alpha");
        assert_eq!(
            out[1].matches,
            vec![SearchMatchRangeV1 { start: 4, end: 9 }]
        );
        assert_eq!(out[2].field, "hyphen");
        assert_eq!(out[2].text, "alpha-beta");
        assert_eq!(
            out[2].matches,
            vec![SearchMatchRangeV1 { start: 6, end: 10 }]
        );

        let rtl = highlights(&["rtl".into()], &sources, &[matched[3].clone()]);
        assert_eq!(rtl[0].text, "שלום עולם");
        assert_eq!(
            rtl[0].matches,
            vec![SearchMatchRangeV1 { start: 0, end: 4 }]
        );
    }
}
