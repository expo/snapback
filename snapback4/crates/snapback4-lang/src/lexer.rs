//! The Quarry lexer, ported from Snapback 2: indentation is significant,
//! comments start with `--`, grouping delimiters suspend newlines.

use crate::diag::{Diagnostic, Site};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Word,
    Number,
    Str,
    Symbol,
    Newline,
    Indent,
    Dedent,
    Eof,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub site: Site,
    pub kind: Kind,
    pub value: String,
}

const TWO_CHARACTER: [&str; 6] = ["<-", "->", "<=", ">=", "!=", "??"];
const SYMBOLS: &str = ":(),[]{}.?!+-~*/%=<>";
const HYPHENATED_WORDS: [&str; 2] = ["until-revoked", "delivered-history"];

pub fn lex(file: &str, source: &str) -> (Vec<Token>, Vec<Diagnostic>) {
    let mut tokens: Vec<Token> = Vec::new();
    let mut diagnostics = Vec::new();
    let token = |line: u32, col: u32, kind: Kind, value: &str| Token { site: Site::new(file, line, col), kind, value: value.to_owned() };
    let mut indents = vec![0usize];
    let mut grouping: i32 = 0;
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    for (line_index, raw) in lines.iter().enumerate() {
        let line = line_index as u32 + 1;
        let chars: Vec<char> = raw.chars().collect();
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("--") {
            continue;
        }
        let leading = chars.iter().take_while(|c| **c == ' ' || **c == '\t').count();
        if chars[..leading].contains(&'\t') {
            diagnostics.push(crate::diag::syntax(&Site::new(file, line, 1), "tabs are not valid indentation; use spaces"));
        }
        let mut offset = leading;
        // A deeper line that opens a shape continues the line above it:
        //   return memberships[viewer] first 50 by byPrincipalConversation
        //     { conversationId, count: messageCounts[.conversationId] }
        let continues = grouping == 0 && (trimmed.starts_with('{') || trimmed.starts_with("and ") || trimmed.starts_with("or ")) && leading > *indents.last().unwrap() && tokens.last().is_some_and(|t| t.kind == Kind::Newline);
        if continues {
            tokens.pop();
        }
        if grouping == 0 && !continues {
            let current = *indents.last().unwrap();
            if offset > current {
                indents.push(offset);
                tokens.push(token(line, 1, Kind::Indent, "<indent>"));
            } else if offset < current {
                while offset < *indents.last().unwrap() {
                    indents.pop();
                    tokens.push(token(line, 1, Kind::Dedent, "<dedent>"));
                }
                if offset != *indents.last().unwrap() {
                    diagnostics.push(crate::diag::syntax(&Site::new(file, line, 1), "indentation does not match an enclosing block"));
                }
            }
        }
        let mut emitted = false;
        while offset < chars.len() {
            let c = chars[offset];
            if c == ' ' || c == '\t' {
                offset += 1;
                continue;
            }
            if c == '-' && chars.get(offset + 1) == Some(&'-') {
                break;
            }
            let site = Site::new(file, line, offset as u32 + 1);
            if c == '#' || (c == '/' && chars.get(offset + 1) == Some(&'/')) {
                diagnostics.push(crate::diag::unsupported(&site, if c == '#' { "#" } else { "//" }, "--"));
                break;
            }
            if offset + 1 < chars.len() {
                let pair: String = chars[offset..offset + 2].iter().collect();
                if TWO_CHARACTER.contains(&pair.as_str()) {
                    tokens.push(Token { site, kind: Kind::Symbol, value: pair });
                    offset += 2;
                    emitted = true;
                    continue;
                }
            }
            if c == '\'' || c == '"' {
                let quote = c;
                let mut value = String::new();
                offset += 1;
                let mut closed = false;
                while offset < chars.len() {
                    let next = chars[offset];
                    if next == quote {
                        offset += 1;
                        closed = true;
                        break;
                    }
                    if next == '\\' {
                        let Some(escaped) = chars.get(offset + 1) else { break };
                        value.push(match escaped {
                            'n' => '\n',
                            't' => '\t',
                            other => *other,
                        });
                        offset += 2;
                    } else {
                        value.push(next);
                        offset += 1;
                    }
                }
                if !closed {
                    diagnostics.push(crate::diag::syntax(&site, "unterminated string literal"));
                }
                tokens.push(Token { site, kind: Kind::Str, value });
                emitted = true;
                continue;
            }
            if c.is_ascii_digit() {
                let start = offset;
                while offset < chars.len() && chars[offset].is_ascii_digit() {
                    offset += 1;
                }
                if chars.get(offset) == Some(&'.') && chars.get(offset + 1).is_some_and(|c| c.is_ascii_digit()) {
                    offset += 1;
                    while offset < chars.len() && chars[offset].is_ascii_digit() {
                        offset += 1;
                    }
                }
                tokens.push(Token { site, kind: Kind::Number, value: chars[start..offset].iter().collect() });
                emitted = true;
                continue;
            }
            if c.is_ascii_alphabetic() || c == '_' {
                let rest: String = chars[offset..].iter().collect();
                let hyphenated = HYPHENATED_WORDS.iter().find(|word| rest.starts_with(*word) && !rest[word.len()..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
                let word: String = match hyphenated {
                    Some(word) => (*word).to_owned(),
                    None => chars[offset..].iter().take_while(|c| c.is_ascii_alphanumeric() || **c == '_').collect(),
                };
                offset += word.chars().count();
                tokens.push(Token { site, kind: Kind::Word, value: word });
                emitted = true;
                continue;
            }
            if SYMBOLS.contains(c) {
                tokens.push(Token { site: site.clone(), kind: Kind::Symbol, value: c.to_string() });
                if "([{".contains(c) {
                    grouping += 1;
                }
                if ")]}".contains(c) {
                    grouping -= 1;
                }
                if grouping < 0 {
                    diagnostics.push(crate::diag::syntax(&site, format!("unexpected {c}")));
                    grouping = 0;
                }
                offset += 1;
                emitted = true;
                continue;
            }
            diagnostics.push(crate::diag::syntax(&site, format!("unexpected character {c:?}")));
            offset += 1;
        }
        if emitted && grouping == 0 {
            tokens.push(token(line, chars.len() as u32 + 1, Kind::Newline, "<newline>"));
        }
    }
    let last_line = lines.len() as u32;
    if grouping != 0 {
        diagnostics.push(crate::diag::syntax(&Site::new(file, last_line, 1), "unclosed grouping delimiter"));
    }
    while indents.len() > 1 {
        indents.pop();
        tokens.push(token(last_line, 1, Kind::Dedent, "<dedent>"));
    }
    tokens.push(token(last_line, 1, Kind::Eof, "<eof>"));
    (tokens, diagnostics)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexes_blocks_and_words() {
        let (tokens, diagnostics) = lex("t.q", "table todos:\n  title: text <=200\n  retain until-revoked\n-- comment\nquery list():\n  return todos[viewer] first 50\n");
        assert!(diagnostics.is_empty());
        let words: Vec<&str> = tokens.iter().map(|t| t.value.as_str()).collect();
        assert_eq!(words[..6], ["table", "todos", ":", "<newline>", "<indent>", "title"]);
        assert!(words.contains(&"until-revoked"));
        assert!(words.contains(&"<="));
        assert_eq!(tokens.last().unwrap().kind, Kind::Eof);
    }
}
