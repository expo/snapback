use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::search::types::*;

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_SEARCH_QUERY_INVALID", "search", message)
}

fn lexical_atom(raw: &str) -> SnapbackResult<SearchMatchAtomV1> {
    let (field, value) = match raw.split_once(':') {
        Some((field, value)) if !field.is_empty() && !value.is_empty() => {
            (Some(field.to_owned()), value)
        }
        _ => (None, raw),
    };
    if value.is_empty() {
        return Err(invalid("empty search atom"));
    }
    if let Some(prefix) = value.strip_suffix('*') {
        if prefix.contains('*') {
            return Err(invalid("wildcards are allowed only as one final suffix"));
        }
        return Ok(SearchMatchAtomV1::Prefix(SearchTermV1 {
            value: prefix.to_owned(),
            field,
        }));
    }
    if value.contains('*') {
        return Err(invalid("wildcards are allowed only as one final suffix"));
    }
    Ok(SearchMatchAtomV1::Term(SearchTermV1 {
        value: value.to_owned(),
        field,
    }))
}

pub fn parse_search_query(input: &str) -> SnapbackResult<SearchQueryAstV1> {
    let mut lexical = Vec::<String>::new();
    let mut current = String::new();
    let mut quote = false;
    for ch in input.chars() {
        match ch {
            '"' => {
                quote = !quote;
                current.push(ch);
            }
            ch if ch.is_whitespace() && !quote => {
                if !current.is_empty() {
                    lexical.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if quote {
        return Err(invalid("unmatched quote"));
    }
    if !current.is_empty() {
        lexical.push(current);
    }
    let mut all = Vec::new();
    let mut any = Vec::new();
    let mut saw_or = false;
    for raw in lexical {
        if raw == "OR" {
            saw_or = true;
            continue;
        }
        let excluded = raw.starts_with('-');
        let raw = raw.strip_prefix('-').unwrap_or(&raw);
        if excluded && saw_or {
            return Err(invalid("an exclusion cannot appear in an OR branch"));
        }
        let atom = if raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2 {
            let phrase = &raw[1..raw.len() - 1];
            SearchMatchAtomV1::Phrase(SearchPhraseV1 {
                values: phrase.split_whitespace().map(ToOwned::to_owned).collect(),
                field: None,
            })
        } else {
            lexical_atom(raw)?
        };
        if excluded {
            all.push(SearchClauseV1::Not(atom));
        } else if saw_or {
            let previous = all.pop().and_then(|clause| match clause {
                SearchClauseV1::Term(value) => Some(SearchMatchAtomV1::Term(value)),
                SearchClauseV1::Phrase(value) => Some(SearchMatchAtomV1::Phrase(value)),
                SearchClauseV1::Prefix(value) => Some(SearchMatchAtomV1::Prefix(value)),
                other => {
                    all.push(other);
                    None
                }
            });
            if let Some(previous) = previous {
                any.push(previous);
            }
            any.push(atom);
            saw_or = false;
        } else {
            all.push(match atom {
                SearchMatchAtomV1::Term(value) => SearchClauseV1::Term(value),
                SearchMatchAtomV1::Phrase(value) => SearchClauseV1::Phrase(value),
                SearchMatchAtomV1::Prefix(value) => SearchClauseV1::Prefix(value),
            });
        }
    }
    if saw_or {
        return Err(invalid("OR requires a following atom"));
    }
    if !any.is_empty() {
        all.push(SearchClauseV1::Any(any));
    }
    Ok(SearchQueryAstV1 { all })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_phrase_prefix_or_and_exclusion_without_backend_syntax() {
        let ast = parse_search_query("\"api latency\" OR checkout* -resolved").unwrap();
        assert!(
            ast.all
                .iter()
                .any(|clause| matches!(clause, SearchClauseV1::Any(_)))
        );
        assert!(
            ast.all
                .iter()
                .any(|clause| matches!(clause, SearchClauseV1::Not(_)))
        );
        assert!(parse_search_query("foo*bar").is_err());
        assert!(parse_search_query("\"unterminated").is_err());
    }
}
