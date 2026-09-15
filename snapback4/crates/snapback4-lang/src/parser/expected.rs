//! Token expectations say which part of a Quarry line to complete.
use crate::lexer::Kind;

pub(super) fn token(expected: &str) -> String {
    match expected {
        "(" => "open the argument or variant list with (; use () for an empty argument list".into(),
        ")" => "separate arguments with commas and close the list with )".into(),
        "]" => "separate keys or list items with commas and close the brackets with ]".into(),
        "}" => "separate fields with commas and close the object or shape with }".into(),
        ":" => "put : after a declaration or block header; parameters use name: type, and object fields use name: expression".into(),
        "<=" => "write <= followed by the maximum size, for example text <=100 or [int] <=10".into(),
        "else" => "finish the guard with else CODE, or the conditional value with else other".into(),
        "in" => "write for item in a bounded page, list or range(start, end)".into(),
        _ => format!("write {expected} at this position to complete the construct"),
    }
}

pub(super) fn kind(expected: Kind) -> &'static str {
    match expected {
        Kind::Word => "write an identifier here; object fields use name: expression, and row fields use row.name or .name inside a shape",
        Kind::Number => "write an integer literal here, for example first 50 or text <=100",
        Kind::Str => "quote the text with ' or \"; enum variants are quoted strings, for example enum('off', 'on')",
        Kind::Newline => "end this statement here; put the next statement on its own line at the same indentation",
        Kind::Indent => "indent the body beneath its header with spaces, for example query q(): followed by an indented return null",
        Kind::Dedent => "finish this block and align the next line with its enclosing header",
        Kind::Eof => "remove the trailing tokens after the final declaration",
        Kind::Symbol => "write the punctuation required by this construct",
    }
}
