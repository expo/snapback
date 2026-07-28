use crate::diagnostic::SnapbackResult;
use crate::search::types::SearchToken;
use crate::search::unicode17_generated::{
    is_control, is_default_ignorable, is_letter_or_number, is_mark, nfkc_case_fold,
};
use unicode_normalization::char::{canonical_combining_class, compose, decompose_canonical};

#[derive(Clone, Copy)]
struct Scalar {
    ch: char,
    start: u32,
    end: u32,
}

fn flush_canonical_segment(segment: &mut Vec<Scalar>, ordered: &mut Vec<Scalar>) {
    if segment.is_empty() {
        return;
    }
    let mark_start = usize::from(canonical_combining_class(segment[0].ch) == 0);
    segment[mark_start..].sort_by_key(|scalar| canonical_combining_class(scalar.ch));
    ordered.append(segment);
}

fn nfc_with_provenance(input: Vec<Scalar>) -> Vec<Scalar> {
    let mut decomposed = Vec::new();
    for source in input {
        decompose_canonical(source.ch, |ch| {
            decomposed.push(Scalar {
                ch,
                start: source.start,
                end: source.end,
            });
        });
    }

    let mut ordered = Vec::with_capacity(decomposed.len());
    let mut segment = Vec::new();
    for scalar in decomposed {
        if canonical_combining_class(scalar.ch) == 0 {
            flush_canonical_segment(&mut segment, &mut ordered);
        }
        segment.push(scalar);
    }
    flush_canonical_segment(&mut segment, &mut ordered);

    let mut composed: Vec<Scalar> = Vec::with_capacity(ordered.len());
    let mut starter = None::<usize>;
    let mut last_class = 0_u8;
    for scalar in ordered {
        let class = canonical_combining_class(scalar.ch);
        let replacement = starter
            .filter(|_| last_class == 0 || last_class < class)
            .and_then(|index| compose(composed[index].ch, scalar.ch).map(|ch| (index, ch)));
        if let Some((index, ch)) = replacement {
            composed[index].ch = ch;
            composed[index].start = composed[index].start.min(scalar.start);
            composed[index].end = composed[index].end.max(scalar.end);
            continue;
        }
        if class == 0 {
            starter = Some(composed.len());
        }
        composed.push(scalar);
        last_class = class;
    }
    composed
}

pub fn normalize(input: &str) -> SnapbackResult<Vec<(char, u32, u32)>> {
    // Rust `str` is Unicode scalar text and therefore cannot contain an
    // unpaired UTF-16 surrogate. Supplementary scalars legitimately encode
    // to a surrogate *pair* on the JavaScript arm and must remain admissible.
    let mut mapped = Vec::new();
    for (index, source) in input.chars().enumerate() {
        let source = if is_control(source) || is_default_ignorable(source) {
            ' '
        } else {
            source
        };
        nfkc_case_fold(source, |ch| {
            mapped.push(Scalar {
                ch,
                start: index as u32,
                end: index as u32 + 1,
            });
        });
    }
    // Unicode's NFKC_CF property is a per-scalar mapping. UAX #44 requires
    // one NFC pass after concatenating those mappings because adjacent source
    // scalars may canonically interact.
    Ok(nfc_with_provenance(mapped)
        .into_iter()
        .map(|scalar| (scalar.ch, scalar.start, scalar.end))
        .collect())
}

pub fn analyze_field(field: &str, input: &str) -> SnapbackResult<Vec<SearchToken>> {
    let normalized = normalize(input)?;
    let mut tokens = Vec::new();
    let mut run = Vec::<(char, u32, u32)>::new();
    let mut position = 0_u32;
    let flush =
        |run: &mut Vec<(char, u32, u32)>, tokens: &mut Vec<SearchToken>, position: &mut u32| {
            if run.is_empty() {
                return;
            }
            let current = *position;
            *position = position.saturating_add(1);
            let has_anchor = run.iter().any(|(ch, _, _)| is_letter_or_number(*ch));
            if has_anchor && run.len() <= 64 {
                let token = run.iter().map(|(ch, _, _)| *ch).collect::<String>();
                let source_start = run.iter().map(|(_, start, _)| *start).min().unwrap_or(0);
                let source_end = run
                    .iter()
                    .map(|(_, _, end)| *end)
                    .max()
                    .unwrap_or(source_start);
                tokens.push(SearchToken {
                    field: field.to_owned(),
                    token,
                    position: current,
                    source_start,
                    source_end,
                });
            }
            run.clear();
        };
    for index in 0..normalized.len() {
        let (ch, start, end) = normalized[index];
        let apostrophe = matches!(ch, '\'' | '\u{2019}');
        let apostrophe_flanked = apostrophe
            && index > 0
            && index + 1 < normalized.len()
            && is_letter_or_number(normalized[index - 1].0)
            && is_letter_or_number(normalized[index + 1].0);
        if is_letter_or_number(ch) || is_mark(ch) || apostrophe_flanked {
            run.push((ch, start, end));
        } else {
            flush(&mut run, &mut tokens, &mut position);
        }
    }
    flush(&mut run, &mut tokens, &mut position);
    Ok(tokens)
}

pub fn analyze_atom(input: &str) -> SnapbackResult<Vec<String>> {
    Ok(analyze_field("", input)?
        .into_iter()
        .map(|token| token.token)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_separator_and_compatibility_vectors() {
        let tokens =
            analyze_atom("ＦＯＯ_bar example.com Straße a\u{200e}b e\u{301} É 👩‍🚀 orbit").unwrap();
        assert_eq!(
            tokens,
            [
                "foo", "bar", "example", "com", "strasse", "a", "b", "é", "é", "orbit"
            ]
        );
        assert_eq!(
            normalize("\u{390}")
                .unwrap()
                .iter()
                .map(|value| value.0)
                .collect::<String>(),
            "\u{390}",
            "NFKC_CF requires the final NFC pass after scalar mappings",
        );
    }

    #[test]
    fn apostrophes_join_only_when_flanked_and_long_runs_keep_phrase_gap() {
        assert_eq!(
            analyze_atom("can't 'quote' rock-n-roll").unwrap(),
            ["can't", "quote", "rock", "n", "roll"]
        );
        let long = "a".repeat(65);
        let tokens = analyze_field("body", &format!("before {long} after")).unwrap();
        assert_eq!(
            tokens
                .iter()
                .map(|t| (&t.token, t.position))
                .collect::<Vec<_>>(),
            [(&"before".to_owned(), 0), (&"after".to_owned(), 2)]
        );
    }
}
