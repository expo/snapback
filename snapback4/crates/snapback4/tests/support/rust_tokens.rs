#[derive(Debug)]
pub(super) struct Token<'a> {
    pub(super) text: &'a str,
    pub(super) line: usize,
}

fn ident(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 128
}

// A deliberately small Rust lexer: punctuation stays separate; string/character
// literals become one opaque token. Raw identifiers keep their canonical name;
// lifetimes remain punctuation + identifier.
pub(super) fn tokens(source: &str) -> Vec<Token<'_>> {
    let bytes = source.as_bytes();
    let mut result = Vec::new();
    let (mut i, mut line) = (0, 1);
    while i < bytes.len() {
        let start = i;
        let start_line = line;
        if bytes[i].is_ascii_whitespace() {
            line += usize::from(bytes[i] == b'\n');
            i += 1;
            continue;
        }
        if bytes[i..].starts_with(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if bytes[i..].starts_with(b"/*") {
            let mut depth = 1;
            i += 2;
            while i < bytes.len() && depth > 0 {
                if bytes[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if bytes[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    line += usize::from(bytes[i] == b'\n');
                    i += 1;
                }
            }
            continue;
        }
        let mut quote = i;
        if matches!(bytes[i], b'b' | b'c') {
            quote += 1;
        }
        let raw = bytes.get(quote) == Some(&b'r');
        if raw {
            quote += 1;
            while bytes.get(quote) == Some(&b'#') {
                quote += 1;
            }
        }
        let string = bytes.get(quote) == Some(&b'"');
        let character = !raw && bytes.get(quote) == Some(&b'\'') && {
            let tail = &source[quote + 1..];
            // A character is one Unicode scalar or an escape, followed by '.
            tail.starts_with('\\')
                || tail
                    .chars()
                    .next()
                    .is_some_and(|c| tail[c.len_utf8()..].starts_with('\''))
        };
        if string || character {
            let delimiter = bytes[quote];
            let hashes = if raw {
                quote - start - 1 - usize::from(bytes[start] != b'r')
            } else {
                0
            };
            i = quote + 1;
            while i < bytes.len() {
                line += usize::from(bytes[i] == b'\n');
                if !raw && bytes[i] == b'\\' {
                    i += 1;
                    if i < bytes.len() {
                        line += usize::from(bytes[i] == b'\n');
                        i += 1;
                    }
                } else if bytes[i] == delimiter
                    && (!raw
                        || bytes
                            .get(i + 1..i + 1 + hashes)
                            .is_some_and(|s| s.iter().all(|b| *b == b'#')))
                {
                    i += 1 + hashes;
                    break;
                } else {
                    i += 1;
                }
            }
            result.push(Token {
                text: "<literal>",
                line: start_line,
            });
        } else {
            let name = if bytes[start..].starts_with(b"r#")
                && bytes.get(start + 2).is_some_and(|b| b.is_ascii_alphabetic() || *b == b'_')
            {
                start + 2
            } else {
                start
            };
            i = name + 1;
            if ident(bytes[name]) {
                while i < bytes.len() && ident(bytes[i]) {
                    i += 1;
                }
            }
            result.push(Token {
                text: &source[name..i],
                line: start_line,
            });
        }
    }
    result
}

pub(super) fn starts(tokens: &[Token<'_>], pattern: &[&str]) -> bool {
    tokens.len() >= pattern.len()
        && tokens
            .iter()
            .zip(pattern)
            .all(|(token, expected)| token.text == *expected)
}
