//! Authoring-only source spans. Never part of the schema, IR or device payload.
use crate::{ast::Expr, lexer::{Kind, Token}};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap {
    expressions: BTreeMap<String, (Expr, String, bool)>,
    pub(crate) declarations: BTreeMap<String, String>,
    pub(crate) repairs: Vec<crate::repair::Candidate>,
}

impl SourceMap {
    pub(crate) fn extend(&mut self, other: &Self) {
        self.expressions.extend(other.expressions.clone());
        self.declarations.extend(other.declarations.clone());
    }

    pub(crate) fn syntax_at(&self, site: &crate::diag::Site) -> Option<&Expr> {
        self.expressions.get(&site.to_string()).map(|(expr, _, _)| expr)
    }

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
        self.expressions.insert(expr.site().to_string(), (expr.clone(), text, grouped));
    }

    pub(crate) fn get(&self, expr: &Expr) -> Option<(String, bool)> {
        let (syntax, text, grouped) = self.expressions.get(&expr.site().to_string())?;
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

#[cfg(test)]
mod tests {
    #[test]
    fn explicit_index_search_sites_retain_authored_spelling() {
        let bound = crate::compile(&[("schema.q".into(), "table posts:\n  body: text <=40\n  at: time\n  by byWords: words(body), at, id\n  public\n  sync public\nquery posts(q: text <=40):\n  return posts matching q first 10 by byWords\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let sites = &bound.schema.operations["posts"].sites;
        assert_eq!(sites.len(), 2, "search and browse alternatives");
        assert!(sites.iter().all(|site| site.site == "schema.q:8:10 (posts matching q first 10 by byWords)"), "{sites:?}");
    }

    #[test]
    fn canonical_backend_sites_do_not_replace_authored_diagnostic_spelling() {
        let bound = crate::compile(&[("schema.q".into(), "table posts:\n  public\n  sync public\nquery posts():\n  return posts first 10\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let program = &bound.programs[0];
        assert_eq!(program.sources["programs.posts.0"].1, "posts first 10");
        assert_eq!(bound.schema.operations["posts"].sites[0].site, "schema.q:5:10 (posts[] first 10)");
    }
}
