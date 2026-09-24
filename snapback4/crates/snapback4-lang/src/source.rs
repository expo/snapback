//! Authoring-only source spans. Never part of the schema, IR or device payload.
use crate::{ast::Expr, lexer::{Kind, Token}};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap(BTreeMap<String, (Expr, String, bool)>);

impl SourceMap {
    pub(crate) fn extend(&mut self, other: &Self) { self.0.extend(other.0.clone()); }

    pub(crate) fn record(&mut self, expr: &Expr, lines: &[String], tokens: &[Token]) {
        // Block expressions consume layout tokens after their final source
        // token. A dedent's site can already be on the next declaration.
        let Some(end) = tokens.iter().rposition(|t| !matches!(t.kind, Kind::Newline | Kind::Indent | Kind::Dedent | Kind::Eof)) else { return };
        let tokens = &tokens[..=end];
        let Some(first) = tokens.first() else { return };
        let Some(last) = tokens.last() else { return };
        let Some(line) = lines.get(last.site.line as usize - 1) else { return };
        let tail: Vec<_> = line.chars().skip(last.site.col as usize - 1).collect();
        let mut length = last.value.chars().count();
        if last.kind == Kind::Str {
            length = 1;
            while length < tail.len() {
                let c = tail[length];
                length += 1;
                if c == tail[0] { break; }
                if c == '\\' { length += 1; }
            }
        }
        let mut text = String::new();
        for number in first.site.line..=last.site.line {
            let Some(line) = lines.get(number as usize - 1) else { return };
            if number != first.site.line { text.push('\n'); }
            let start = if number == first.site.line { first.site.col as usize - 1 } else { 0 };
            let end = if number == last.site.line { last.site.col as usize - 1 + length } else { line.chars().count() };
            text.extend(line.chars().skip(start).take(end.saturating_sub(start)));
        }
        let mut depth = 0_i32;
        let grouped = first.kind == Kind::Symbol && first.value == "(" && tokens.iter().enumerate().all(|(i, t)| {
            if t.kind == Kind::Symbol {
                if t.value == "(" { depth += 1; }
                if t.value == ")" { depth -= 1; }
            }
            depth > 0 || i + 1 == tokens.len()
        }) && depth == 0;
        self.0.insert(expr.site().to_string(), (expr.clone(), text, grouped));
    }

    pub(crate) fn get(&self, expr: &Expr) -> Option<(String, bool)> {
        let (syntax, text, grouped) = self.0.get(&expr.site().to_string())?;
        // A planner may reuse a site while changing the expression.
        (syntax == expr).then(|| (text.clone(), *grouped))
    }

    pub(crate) fn expression(&self, expr: &Expr) -> String {
        crate::print::with_source(expr, &|expr| self.get(expr))
    }

    /// A comparison's operand needs parentheses around booleans and conditionals.
    pub(crate) fn operand(&self, expr: &Expr) -> String {
        crate::print::with_source_at(expr, 5, &|expr| self.get(expr))
    }
}
