//! Auth collision-rescue contract and token-aware SQLite DDL rewriting.
//!
//! Database catalog access stays in `storage::auth_rescue`; this module owns
//! request validation, result shape, and the deliberately tiny SQL rewriter.

// @ref LLP 0057#transactional-algorithm — rescue replaces only leading schema-object identifiers and never text-replaces literals or comments.

use crate::auth::wire::RescueCollidingTableRequest;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use serde::Serialize;
use std::path::Path;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(deny_unknown_fields)]
pub(crate) struct CollisionRescueResult {
    pub source: String,
    pub target: String,
    pub copied_row_count: u64,
    pub copied_explicit_index_count: usize,
    pub manifest_updated: bool,
    pub catalog_collision_cleared: bool,
}

/// Run rescue through an already-open ordinary database. The caller owns the
/// exclusive maintenance guard and leaves the process restart-required.
pub(crate) fn rescue_colliding_table(
    database: &mut LocalDatabase,
    request: &RescueCollidingTableRequest,
) -> SnapbackResult<CollisionRescueResult> {
    validate_names(&request.source_table, &request.target_table)?;
    database.rescue_auth_collision(&request.source_table, &request.target_table)
}

/// Recovery-path variant for a stored legacy manifest that normal
/// `LocalDatabase::open` correctly rejects under the absolute reservation.
pub(crate) fn rescue_colliding_table_file(
    database_path: &Path,
    request: &RescueCollidingTableRequest,
) -> SnapbackResult<CollisionRescueResult> {
    validate_names(&request.source_table, &request.target_table)?;
    LocalDatabase::rescue_auth_collision_file(
        database_path,
        &request.source_table,
        &request.target_table,
    )
}

pub(crate) fn validate_names(source: &str, target: &str) -> SnapbackResult<()> {
    if source.is_empty()
        || source.len() > 255
        || source.contains('\0')
        || !crate::storage::is_auth_reserved_identifier(source)
        || !valid_identifier(target)
        || crate::storage::is_auth_reserved_identifier(target)
        || target.to_ascii_lowercase().starts_with("_snapback")
        || target.to_ascii_lowercase().starts_with("sqlite_")
        || source.eq_ignore_ascii_case(target)
    {
        return Err(rescue_invalid("collision rescue table names are invalid"));
    }
    Ok(())
}

pub(crate) fn valid_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

pub(crate) fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(crate) fn rewrite_create_table(
    sql: &str,
    source: &str,
    target: &str,
) -> Result<String, RewriteError> {
    let tokens = tokenize(sql)?;
    let significant = significant_tokens(&tokens);
    let mut cursor = 0;
    expect_keyword(&significant, &mut cursor, "CREATE")?;
    consume_keyword(&significant, &mut cursor, "TEMP");
    consume_keyword(&significant, &mut cursor, "TEMPORARY");
    if peek_keyword(&significant, cursor, "VIRTUAL") {
        return Err(RewriteError);
    }
    expect_keyword(&significant, &mut cursor, "TABLE")?;
    consume_if_not_exists(&significant, &mut cursor)?;
    let object = object_name_token(&significant, &mut cursor)?;
    require_identifier(object, source)?;
    expect_symbol(&significant, &mut cursor, '(')?;
    replace_spans(sql, &[(object.start, object.end, quote_identifier(target))])
}

pub(crate) fn rewrite_create_index(
    sql: &str,
    source_index: &str,
    source_table: &str,
    target_index: &str,
    target_table: &str,
) -> Result<String, RewriteError> {
    let tokens = tokenize(sql)?;
    let significant = significant_tokens(&tokens);
    let mut cursor = 0;
    expect_keyword(&significant, &mut cursor, "CREATE")?;
    consume_keyword(&significant, &mut cursor, "UNIQUE");
    expect_keyword(&significant, &mut cursor, "INDEX")?;
    consume_if_not_exists(&significant, &mut cursor)?;
    let index = object_name_token(&significant, &mut cursor)?;
    require_identifier(index, source_index)?;
    expect_keyword(&significant, &mut cursor, "ON")?;
    let table = object_name_token(&significant, &mut cursor)?;
    require_identifier(table, source_table)?;
    expect_symbol(&significant, &mut cursor, '(')?;
    replace_spans(
        sql,
        &[
            (index.start, index.end, quote_identifier(target_index)),
            (table.start, table.end, quote_identifier(target_table)),
        ],
    )
}

/// Conservative dependency scan. Strings containing the source are ambiguous
/// under SQLite's legacy quoting behavior, so they also cause refusal;
/// comments are trivia and never count.
pub(crate) fn sql_may_reference_identifier(
    sql: &str,
    identifier: &str,
) -> Result<bool, RewriteError> {
    let folded_identifier = identifier.to_ascii_lowercase();
    Ok(tokenize(sql)?.iter().any(|token| match token.kind {
        TokenKind::Word | TokenKind::QuotedIdentifier => token
            .decoded
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case(identifier)),
        TokenKind::String => token.decoded.as_deref().is_some_and(|value| {
            value
                .to_ascii_lowercase()
                .contains(folded_identifier.as_str())
        }),
        _ => false,
    }))
}

fn replace_spans(
    sql: &str,
    replacements: &[(usize, usize, String)],
) -> Result<String, RewriteError> {
    let mut replacements = replacements.to_vec();
    replacements.sort_by_key(|replacement| replacement.0);
    let mut output = String::with_capacity(sql.len() + 32);
    let mut cursor = 0;
    for (start, end, replacement) in replacements {
        if start < cursor
            || end < start
            || !sql.is_char_boundary(start)
            || !sql.is_char_boundary(end)
        {
            return Err(RewriteError);
        }
        output.push_str(&sql[cursor..start]);
        output.push_str(&replacement);
        cursor = end;
    }
    output.push_str(&sql[cursor..]);
    Ok(output)
}

fn consume_if_not_exists(tokens: &[&Token], cursor: &mut usize) -> Result<(), RewriteError> {
    if peek_keyword(tokens, *cursor, "IF") {
        expect_keyword(tokens, cursor, "IF")?;
        expect_keyword(tokens, cursor, "NOT")?;
        expect_keyword(tokens, cursor, "EXISTS")?;
    }
    Ok(())
}

fn object_name_token<'a>(
    tokens: &[&'a Token],
    cursor: &mut usize,
) -> Result<&'a Token, RewriteError> {
    let first = *tokens.get(*cursor).ok_or(RewriteError)?;
    *cursor += 1;
    if matches!(tokens.get(*cursor), Some(token) if token.is_symbol('.')) {
        require_any_identifier(first)?;
        *cursor += 1;
        let object = *tokens.get(*cursor).ok_or(RewriteError)?;
        *cursor += 1;
        require_any_identifier(object)?;
        Ok(object)
    } else {
        require_any_identifier(first)?;
        Ok(first)
    }
}

fn require_any_identifier(token: &Token) -> Result<(), RewriteError> {
    if matches!(
        token.kind,
        TokenKind::Word | TokenKind::QuotedIdentifier | TokenKind::String
    ) && token.decoded.is_some()
    {
        Ok(())
    } else {
        Err(RewriteError)
    }
}

fn require_identifier(token: &Token, expected: &str) -> Result<(), RewriteError> {
    require_any_identifier(token)?;
    if token
        .decoded
        .as_deref()
        .is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
    {
        Ok(())
    } else {
        Err(RewriteError)
    }
}

fn expect_keyword(
    tokens: &[&Token],
    cursor: &mut usize,
    expected: &str,
) -> Result<(), RewriteError> {
    if peek_keyword(tokens, *cursor, expected) {
        *cursor += 1;
        Ok(())
    } else {
        Err(RewriteError)
    }
}

fn consume_keyword(tokens: &[&Token], cursor: &mut usize, expected: &str) -> bool {
    if peek_keyword(tokens, *cursor, expected) {
        *cursor += 1;
        true
    } else {
        false
    }
}

fn peek_keyword(tokens: &[&Token], cursor: usize, expected: &str) -> bool {
    tokens.get(cursor).is_some_and(|token| {
        token.kind == TokenKind::Word
            && token
                .decoded
                .as_deref()
                .is_some_and(|word| word.eq_ignore_ascii_case(expected))
    })
}

fn expect_symbol(
    tokens: &[&Token],
    cursor: &mut usize,
    expected: char,
) -> Result<(), RewriteError> {
    if tokens
        .get(*cursor)
        .is_some_and(|token| token.is_symbol(expected))
    {
        *cursor += 1;
        Ok(())
    } else {
        Err(RewriteError)
    }
}

fn significant_tokens(tokens: &[Token]) -> Vec<&Token> {
    tokens
        .iter()
        .filter(|token| token.kind != TokenKind::Trivia)
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RewriteError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TokenKind {
    Trivia,
    Word,
    QuotedIdentifier,
    String,
    Symbol(char),
    Other,
}

#[derive(Debug)]
struct Token {
    start: usize,
    end: usize,
    kind: TokenKind,
    decoded: Option<String>,
}

impl Token {
    fn is_symbol(&self, expected: char) -> bool {
        self.kind == TokenKind::Symbol(expected)
    }
}

fn tokenize(sql: &str) -> Result<Vec<Token>, RewriteError> {
    if sql.as_bytes().contains(&0) {
        return Err(RewriteError);
    }
    let mut tokens = Vec::new();
    let mut cursor = 0;
    while cursor < sql.len() {
        let rest = &sql[cursor..];
        let character = rest.chars().next().ok_or(RewriteError)?;
        if character.is_whitespace() {
            let start = cursor;
            cursor += character.len_utf8();
            while cursor < sql.len() {
                let next = sql[cursor..].chars().next().ok_or(RewriteError)?;
                if !next.is_whitespace() {
                    break;
                }
                cursor += next.len_utf8();
            }
            tokens.push(Token::plain(start, cursor, TokenKind::Trivia));
            continue;
        }
        if rest.starts_with("--") {
            let start = cursor;
            cursor = sql[cursor..]
                .find('\n')
                .map_or(sql.len(), |offset| cursor + offset + 1);
            tokens.push(Token::plain(start, cursor, TokenKind::Trivia));
            continue;
        }
        if rest.starts_with("/*") {
            let start = cursor;
            let Some(offset) = sql[cursor + 2..].find("*/") else {
                return Err(RewriteError);
            };
            cursor = cursor + 2 + offset + 2;
            tokens.push(Token::plain(start, cursor, TokenKind::Trivia));
            continue;
        }
        if matches!(character, '\'' | '"' | '`' | '[') {
            let (end, decoded) = scan_quoted(sql, cursor, character)?;
            let kind = if character == '\'' {
                TokenKind::String
            } else {
                TokenKind::QuotedIdentifier
            };
            tokens.push(Token {
                start: cursor,
                end,
                kind,
                decoded: Some(decoded),
            });
            cursor = end;
            continue;
        }
        if is_word_start(character) {
            let start = cursor;
            cursor += character.len_utf8();
            while cursor < sql.len() {
                let next = sql[cursor..].chars().next().ok_or(RewriteError)?;
                if !is_word_continue(next) {
                    break;
                }
                cursor += next.len_utf8();
            }
            tokens.push(Token {
                start,
                end: cursor,
                kind: TokenKind::Word,
                decoded: Some(sql[start..cursor].to_owned()),
            });
            continue;
        }
        cursor += character.len_utf8();
        let kind = if "().,;".contains(character) {
            TokenKind::Symbol(character)
        } else {
            TokenKind::Other
        };
        tokens.push(Token::plain(cursor - character.len_utf8(), cursor, kind));
    }
    Ok(tokens)
}

impl Token {
    fn plain(start: usize, end: usize, kind: TokenKind) -> Self {
        Self {
            start,
            end,
            kind,
            decoded: None,
        }
    }
}

fn scan_quoted(sql: &str, start: usize, opener: char) -> Result<(usize, String), RewriteError> {
    let closer = if opener == '[' { ']' } else { opener };
    let mut cursor = start + opener.len_utf8();
    let mut decoded = String::new();
    while cursor < sql.len() {
        let character = sql[cursor..].chars().next().ok_or(RewriteError)?;
        cursor += character.len_utf8();
        if character == closer {
            if opener != '[' && cursor < sql.len() && sql[cursor..].starts_with(closer) {
                decoded.push(closer);
                cursor += closer.len_utf8();
                continue;
            }
            return Ok((cursor, decoded));
        }
        decoded.push(character);
    }
    Err(RewriteError)
}

fn is_word_start(character: char) -> bool {
    character == '_' || character.is_alphabetic() || !character.is_ascii()
}

fn is_word_continue(character: char) -> bool {
    is_word_start(character) || character.is_ascii_digit() || character == '$'
}

fn rescue_invalid(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_RESCUE_INVALID", "auth-rescue", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_rewriter_changes_only_the_leading_identifier() {
        let sql = "/* lead */ CREATE TABLE IF NOT EXISTS main.[_AuTh_Old] (\n\
                   value TEXT DEFAULT '_AuTh_Old',\n\
                   note TEXT CHECK(note <> \"_AuTh_Old\")\n\
                 ) -- _AuTh_Old";
        let rewritten = rewrite_create_table(sql, "_auth_old", "legacy_table").unwrap();
        assert_eq!(
            rewritten,
            sql.replacen("[_AuTh_Old]", "\"legacy_table\"", 1)
        );
    }

    #[test]
    fn index_rewriter_preserves_unique_partial_expression_text() {
        let sql = "CREATE UNIQUE INDEX main.`old index` ON main.\"_auth_old\" \
                   (value COLLATE NOCASE DESC) WHERE note = '_auth_old'";
        let rewritten = rewrite_create_index(
            sql,
            "old index",
            "_auth_old",
            "legacy__rescue_idx_0",
            "legacy",
        )
        .unwrap();
        assert_eq!(
            rewritten,
            "CREATE UNIQUE INDEX main.\"legacy__rescue_idx_0\" ON main.\"legacy\" \
             (value COLLATE NOCASE DESC) WHERE note = '_auth_old'"
        );
    }

    #[test]
    fn dependency_scan_ignores_comments_but_refuses_ambiguous_strings() {
        assert!(
            !sql_may_reference_identifier(
                "CREATE VIEW ordinary AS SELECT 1 /* _auth_old */",
                "_auth_old"
            )
            .unwrap()
        );
        assert!(
            sql_may_reference_identifier("CREATE VIEW ordinary AS SELECT '_auth_old'", "_auth_old")
                .unwrap()
        );
        assert!(
            sql_may_reference_identifier(
                "CREATE VIEW ordinary AS SELECT * FROM \"_AUTH_OLD\"",
                "_auth_old"
            )
            .unwrap()
        );
    }

    #[test]
    fn unsupported_or_ambiguous_create_shapes_are_rejected() {
        assert!(
            rewrite_create_table(
                "CREATE VIRTUAL TABLE _auth_old USING fts5(value)",
                "_auth_old",
                "legacy"
            )
            .is_err()
        );
        assert!(
            rewrite_create_table("CREATE TABLE _auth_old AS SELECT 1", "_auth_old", "legacy")
                .is_err()
        );
        assert!(
            rewrite_create_index(
                "CREATE INDEX idx ON other(value)",
                "idx",
                "_auth_old",
                "new_idx",
                "legacy"
            )
            .is_err()
        );
        assert!(sql_may_reference_identifier("SELECT 'unterminated", "x").is_err());
        assert!(sql_may_reference_identifier("SELECT 1 /* unterminated", "x").is_err());
    }

    #[test]
    fn request_names_are_exact_ascii_identifiers() {
        assert!(validate_names("_AUTH_Legacy", "legacy_auth").is_ok());
        for (source, target) in [
            ("ordinary", "legacy"),
            ("_auth_old", "_auth_new"),
            ("_auth_old", "_snapback_hidden"),
            ("_auth_old", "_SnApBaCk_hidden"),
            ("_auth_old", "sqlite_hidden"),
            ("_auth_old", "not-valid"),
            ("_auth_old", "_AUTH_OLD"),
        ] {
            assert_eq!(
                validate_names(source, target).unwrap_err().diagnostic.code,
                "SNAPBACK_AUTH_RESCUE_INVALID"
            );
        }
    }
}
