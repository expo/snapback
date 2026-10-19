//! The Quarry parser, ported from Snapback 2. Every refusal is a located
//! diagnostic with a rewrite; the parser recovers per line and per
//! declaration so one document yields every problem at once.

use crate::ast::*;
use crate::diag::{Diagnostic, Fallible, Site, syntax, syntax_with, unsupported};
use crate::lexer::{Kind, Token, lex};
use crate::print;

mod expr;
mod predicates;
pub(crate) mod repairs;
mod views;
mod maintains;
mod timeline;
mod expected;
mod types;
mod reserved;
pub(crate) use reserved::repeated_identity;
mod programs;
mod actions;
mod routes;
mod security;

pub(crate) fn precedence(op: &str) -> Option<u8> {
    Some(match op {
        "??" => 1,
        "or" => 2,
        "and" => 3,
        "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

pub fn parse_document(file: &str, source: &str) -> (Document, Vec<Diagnostic>) {
    parse_with_types(file, source, Vec::new(), Default::default())
}

pub(crate) fn parse_with_types(file: &str, source: &str, known_tables: Vec<TableDecl>, known_views: std::collections::BTreeMap<String, crate::types::Ty>) -> (Document, Vec<Diagnostic>) {
    let (tokens, diagnostics) = lex(file, source);
    let source = source.replace("\r\n", "\n").replace('\r', "\n").split('\n').map(str::to_owned).collect();
    let mut parser = Parser { source, tokens, position: 0, declaration_start: 0, comparison_spans: Default::default(), expression_spans: Default::default(), diagnostics, focal_table: None, repair_args: None, known_tables, known_views, document: Document { file: file.to_owned(), ..Document::default() } };
    parser.document();
    (parser.document, parser.diagnostics)
}

struct Parser {
    source: Vec<String>,
    tokens: Vec<Token>,
    position: usize,
    declaration_start: usize,
    comparison_spans: std::collections::BTreeMap<(u32, u32), std::ops::Range<usize>>,
    expression_spans: std::collections::BTreeMap<(u32, u32), std::ops::Range<usize>>,
    diagnostics: Vec<Diagnostic>,
    document: Document,
    focal_table: Option<String>,
    known_tables: Vec<TableDecl>,
    known_views: std::collections::BTreeMap<String, crate::types::Ty>,
    repair_args: Option<(Site, Vec<ArgDecl>)>,
}

            "backfill" => {
                let site = self.take("backfill")?.site;
                let table = self.word()?.value;
                let name = self.binding_name()?;
                let args = self.parse_args()?;
                self.take(":")?;
                let indented = self.at_kind(Kind::Newline);
                if indented { self.newline()?; self.take_kind(Kind::Indent)?; }
                let value = self.expression(0, &["<newline>"])?;
                self.newline()?;
                if indented { self.take_kind(Kind::Dedent)?; }
                self.document.backfills.push(BackfillDecl { table, name, args, value, site });
                Ok(())
            }
