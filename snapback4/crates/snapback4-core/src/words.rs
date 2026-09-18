//! Words: the one tokenizer behind a `words(..)` index component and a
//! `matching` read, on every host. A row's text columns become distinct
//! folded tokens, one index entry each; a query becomes folded terms, the
//! first of which selects the index lanes (every word the term is a prefix
//! of) and the rest of which every row must also carry. The contract is
//! fixed and named: NFC normalization, Unicode lowercase, a boundary at
//! every character that is neither a letter nor a digit. On the web only
//! NFC comes from the guarded host: Unicode stability covers normalization
//! of assigned characters, not case mappings, so lowercase stays Rust.

#[cfg(not(all(target_arch = "wasm32", feature = "web")))]
use unicode_normalization::UnicodeNormalization;

/// The contract a `words` component records in the schema, so a store built
/// under one tokenizer is never read under another.
pub const CONTRACT: &str = "nfc-lower-alnum-1";

/// A token longer than this is cut: a prefix of a word is still a word.
pub const MAX_TOKEN_CHARS: usize = 64;
/// Worst-case UTF-8 body of that same token cap (indexed and queried alike).
pub const MAX_TOKEN_BYTES: usize = 4 * MAX_TOKEN_CHARS;
/// A row contributes at most this many distinct tokens per index; a text
/// column is bounded, so this bounds the entries one write costs.
pub const MAX_TOKENS_PER_ROW: usize = 512;
/// A query has at most this many terms; more is an input error, not a scan.
pub const MAX_TERMS: usize = 8;

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — host NFC with Rust lowercase; the web constructor guards normalization.
/// NFC followed by locale-independent lowercase, before token boundaries.
pub fn fold(text: &str) -> String {
    #[cfg(all(target_arch = "wasm32", feature = "web"))]
    {
        if text.is_ascii() { return text.to_ascii_lowercase(); }
        String::from(js_sys::JsString::from(text).normalize("NFC")).to_lowercase()
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "web")))]
    { text.nfc().collect::<String>().to_lowercase() }
}

/// Fold text into its tokens: NFC, lowercase, split on anything that is not
/// a letter or a digit, distinct, in order of first appearance.
pub fn tokens(text: &str) -> Vec<String> {
    let folded = fold(text);
    let mut out: Vec<String> = Vec::new();
    for word in folded.split(|c: char| !c.is_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        let word: String = word.chars().take(MAX_TOKEN_CHARS).collect();
        if !out.contains(&word) {
            out.push(word);
            if out.len() == MAX_TOKENS_PER_ROW {
                break;
            }
        }
    }
    out
}

/// The distinct tokens of several columns' text, for one index entry set.
pub fn row_tokens<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for text in texts {
        for token in tokens(text) {
            if !out.contains(&token) {
                out.push(token);
                if out.len() == MAX_TOKENS_PER_ROW {
                    return out;
                }
            }
        }
    }
    out
}

/// A query's terms: the same folding as the rows, at most `MAX_TERMS`.
/// An empty query has no terms, and no terms match nothing (never
/// everything).
pub fn terms(query: &str) -> Vec<String> {
    let mut out = tokens(query);
    out.truncate(MAX_TERMS);
    out
}

/// Whether every term is a prefix of some token of the row's text.
pub fn row_matches(row_tokens: &[String], terms: &[String]) -> bool {
    terms.iter().all(|term| row_tokens.iter().any(|token| token.starts_with(term.as_str())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_case_and_splits_on_punctuation() {
        assert_eq!(tokens("Coffee time, Carol! (don't) café"), vec!["coffee", "time", "carol", "don", "t", "café"]);
        assert_eq!(tokens("carol_smith"), vec!["carol", "smith"]);
        assert_eq!(tokens("  "), Vec::<String>::new());
    }

    #[test]
    fn normalizes_to_nfc_so_composed_and_decomposed_agree() {
        // e + combining acute (NFD) folds to the same token as é (NFC).
        assert_eq!(tokens("cafe\u{301}"), tokens("caf\u{e9}"));
    }

    #[test]
    fn distinct_and_bounded() {
        assert_eq!(tokens("a a A b"), vec!["a", "b"]);
        let long = "x".repeat(200);
        assert_eq!(tokens(&long)[0].chars().count(), MAX_TOKEN_CHARS);
        let many: String = (0..1_000).map(|n| format!("w{n} ")).collect();
        assert_eq!(tokens(&many).len(), MAX_TOKENS_PER_ROW);
    }

    #[test]
    fn long_unicode_words_and_query_terms_share_the_portable_cap() {
        let text = "𐐨".repeat(100);
        let indexed = tokens(&text);
        assert_eq!(indexed[0].len(), MAX_TOKEN_BYTES);
        assert_eq!(terms(&text), indexed);
        assert!(row_matches(&indexed, &terms(&text)));
    }

    #[test]
    fn terms_match_as_prefixes() {
        let row = row_tokens(["Coffee time", "with Carol"]);
        assert!(row_matches(&row, &terms("cof")));
        assert!(row_matches(&row, &terms("COF car")));
        assert!(!row_matches(&row, &terms("cof bob")));
        assert!(terms("").is_empty());
    }
}
