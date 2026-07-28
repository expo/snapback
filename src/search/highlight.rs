use crate::search::types::{SearchHighlightV1, SearchMatchRangeV1, SearchToken};
use unicode_segmentation::UnicodeSegmentation;

/// Build at most three plain-text fragments. Source ranges are scalar offsets;
/// grapheme boundaries are used only to select/extract, so no client receives
/// split combining or emoji sequences.
///
/// @ref LLP 0073#highlights-and-private-data — bounded plain text and scalar
/// ranges, never backend-generated HTML.
pub fn highlights(
    field_order: &[String],
    source_fields: &std::collections::BTreeMap<String, String>,
    matched: &[&SearchToken],
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
            .then(a.token.cmp(&b.token))
    });
    let mut result = Vec::new();
    for occurrence in ordered {
        if result.len() >= 3 {
            break;
        }
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
        result.push(SearchHighlightV1 {
            field: occurrence.field.clone(),
            text: source[byte_start..byte_end].to_owned(),
            matches: vec![SearchMatchRangeV1 {
                start: occurrence.source_start.saturating_sub(scalar_base),
                end: occurrence.source_end.saturating_sub(scalar_base),
            }],
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::analyzer::analyze_field;
    use std::collections::BTreeMap;

    #[test]
    fn fragments_are_plain_bounded_and_grapheme_safe() {
        let source = "before e\u{301} match after";
        let tokens = analyze_field("body", source).unwrap();
        let hit = tokens.iter().find(|token| token.token == "match").unwrap();
        let out = highlights(
            &["body".into()],
            &BTreeMap::from([("body".into(), source.into())]),
            &[hit],
        );
        assert_eq!(out.len(), 1);
        assert!(out[0].text.len() <= 256);
        assert_eq!(out[0].matches.len(), 1);
    }
}
