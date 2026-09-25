//! Diagnostic-only source edits. A malformed span must lose its repair, never
//! crash the compiler or splice a different declaration.
use super::*;
use crate::types::Ty;
use std::ops::Range;

impl Parser {
    pub(super) fn table_decl(&self, name: &str) -> Option<&TableDecl> {
        self.document.tables.iter().chain(&self.known_tables).find(|table| table.name == name)
    }

    pub(super) fn column_type(&self, table: &str, column: &str) -> Option<ScalarType> {
        if let Some(table) = self.table_decl(table) {
            return if column == "id" { Some(ScalarType { kind: TypeKind::Id, optional: false }) }
                else { table.columns.iter().find(|c| c.name == column).map(|c| c.type_.clone()) };
        }
        let Ty::RowShape(fields) = self.known_views.get(table)? else { return None; };
        scalar_type(fields.get(column)?)
    }

    fn source_offset(&self, site: &Site) -> Option<usize> {
        let line = usize::try_from(site.line).ok()?.checked_sub(1)?;
        let col = usize::try_from(site.col).ok()?.checked_sub(1)?;
        let text = self.source.get(line)?;
        let byte = text.char_indices().map(|(i, _)| i).chain([text.len()]).nth(col)?;
        Some(self.source.get(..line)?.iter().map(|s| s.len() + 1).sum::<usize>() + byte)
    }

    fn token_end(&self, token: &Token, source: &str) -> Option<usize> {
        let start = self.source_offset(&token.site)?;
        let tail = source.get(start..)?;
        if token.kind != Kind::Str {
            return tail.starts_with(&token.value).then(|| start + token.value.len());
        }
        let mut chars = tail.char_indices();
        let (_, quote @ ('\'' | '"')) = chars.next()? else { return None; };
        while let Some((i, ch)) = chars.next() {
            if ch == '\\' { chars.next()?; }
            else if ch == quote { return Some(start + i + ch.len_utf8()); }
        }
        None
    }

    // Delimiters suppress layout tokens. A closing ')' at column one therefore
    // stays in the declaration, regardless of its physical indentation.
    fn declaration_tokens(&self) -> Option<Range<usize>> {
        let mut indent = 0usize;
        let mut delimiters = Vec::new();
        let mut statement_start = false;
        for (i, token) in self.tokens.iter().enumerate().skip(self.declaration_start) {
            match token.kind {
                Kind::Eof => return delimiters.is_empty().then_some(self.declaration_start..i),
                Kind::Indent => { indent += 1; continue; }
                Kind::Dedent => { indent = indent.checked_sub(1)?; statement_start = true; continue; }
                Kind::Newline => { statement_start = true; continue; }
                _ => {}
            }
            if statement_start && indent == 0 && delimiters.is_empty() {
                return Some(self.declaration_start..i);
            }
            statement_start = false;
            if token.kind == Kind::Symbol {
                match token.value.as_str() {
                    "(" => delimiters.push(")"), "[" => delimiters.push("]"), "{" => delimiters.push("}"),
                    ")" | "]" | "}" if delimiters.pop() != Some(token.value.as_str()) => return None,
                    _ => {}
                }
            }
        }
        None
    }

    pub(super) fn fresh_parameter(&self, column: &str, args: &[ArgDecl]) -> Option<String> {
        let tokens = self.tokens.get(self.declaration_tokens()?)?;
        let bindings: std::collections::BTreeSet<_> = tokens.iter().enumerate().filter_map(|(i, token)| {
            (token.kind == Kind::Word && tokens.get(i + 1).is_some_and(|t| t.value == "=")
                && i.checked_sub(1).and_then(|j| tokens.get(j)).is_none_or(|t| t.value != "."))
                .then_some(token.value.as_str())
        }).collect();
        let mut name = column.to_owned();
        while bindings.contains(name.as_str()) || args.iter().any(|arg| arg.name == name) { name.push_str("Argument"); }
        Some(name)
    }

    fn token_span(&self, tokens: Range<usize>) -> Option<Range<usize>> {
        if tokens.start >= tokens.end { return None; }
        let source = self.source.join("\n");
        let start = self.source_offset(&self.tokens.get(tokens.start)?.site)?;
        let end = self.token_end(self.tokens.get(tokens.end.checked_sub(1)?)?, &source)?;
        source.get(start..end)?;
        Some(start..end)
    }

    fn comparison_span(&self, site: &Site) -> Option<Range<usize>> {
        self.token_span(self.comparison_spans.get(&(site.line, site.col))?.clone())
    }

    pub(super) fn comparison_source(&self, site: &Site) -> Option<String> {
        self.source.join("\n").get(self.comparison_span(site)?).map(str::to_owned)
    }

    pub(super) fn predicate_rewrite(&self, start: usize, end: usize, site: &Site, replacement: &str) -> Option<String> {
        self.source_rewrite(self.token_span(start..end)?, vec![(self.comparison_span(site)?, replacement.into())])
    }

    pub(super) fn declaration_rewrite(&self, site: &Site, replacement: &str, argument: Option<(&Site, String)>) -> Option<String> {
        let source = self.source.join("\n");
        let tokens = self.declaration_tokens()?;
        let start = self.source_offset(&self.tokens.get(tokens.start)?.site)?;
        let last = self.tokens.get(tokens.end)?;
        let end = if last.kind == Kind::Eof { source.len() } else { self.source_offset(&last.site)? };
        let comparison = self.comparison_span(site)?;
        let mut edits = vec![(comparison.clone(), replacement.into())];
        if let Some((site, value)) = argument {
            let at = self.source_offset(site)?;
            if source.get(at..)?.chars().next()? != '(' || at >= comparison.start { return None; }
            let at = at.checked_add(1)?;
            edits.push((at..at, value));
        }
        self.source_rewrite(start..end, edits)
    }

    // A key repair inserts the new key and replaces only the offending
    // comparison with true. Retained predicates, including nested read keys,
    // stay byte-for-byte intact; reprinting can change their focal scope.
    pub(super) fn keyed_read_rewrite(&self, read: &ReadExpr, site: &Site, column: &str) -> Option<String> {
        let start = self.tokens.iter().position(|t| t.site == read.site && t.kind == Kind::Word && t.value == read.table)?;
        let span = self.token_span(start..self.position)?;
        let key = format!("{column} = .{column}");
        let (at, insertion) = if self.tokens.get(start + 1)?.value == "[" {
            let mut depth = 0usize;
            let mut close = None;
            for i in start + 1..self.position {
                let token = self.tokens.get(i)?;
                if token.kind != Kind::Symbol { continue; }
                match token.value.as_str() {
                    "[" => depth += 1,
                    "]" => { depth = depth.checked_sub(1)?; if depth == 0 { close = Some(i); break; } }
                    _ => {}
                }
            }
            let close = close?;
            let separator = if matches!(self.tokens.get(close.checked_sub(1)?)?.value.as_str(), "[" | ",") { "" } else { ", " };
            (self.source_offset(&self.tokens.get(close)?.site)?, format!("{separator}{key}"))
        } else {
            (self.token_end(self.tokens.get(start)?, &self.source.join("\n"))?, format!("[{key}]"))
        };
        self.source_rewrite(span, vec![(at..at, insertion), (self.comparison_span(site)?, "true".into())])
    }

    fn source_rewrite(&self, span: Range<usize>, edits: Vec<(Range<usize>, String)>) -> Option<String> {
        let source = self.source.join("\n");
        let mut relative = Vec::new();
        for (edit, text) in edits {
            if edit.end > span.end { return None; }
            relative.push((edit.start.checked_sub(span.start)?..edit.end.checked_sub(span.start)?, text));
        }
        splice(source.get(span)?, relative)
    }
}

fn splice(source: &str, mut edits: Vec<(Range<usize>, String)>) -> Option<String> {
    edits.sort_by_key(|(span, _)| span.start);
    let mut previous = 0;
    for (span, _) in &edits {
        if span.start < previous || source.get(span.clone()).is_none() { return None; }
        previous = span.end;
    }
    let mut result = source.to_owned();
    for (span, value) in edits.into_iter().rev() { result.replace_range(span, &value); }
    Some(result)
}

// Only types representable as arguments can support an argument repair. Blob
// bounds and row shapes are intentionally not guessed from an erased type.
fn scalar_type(ty: &Ty) -> Option<ScalarType> {
    let kind = match ty.required() {
        Ty::Id => TypeKind::Id, Ty::Principal => TypeKind::Principal,
        Ty::Bool => TypeKind::Bool, Ty::Int => TypeKind::Int, Ty::Time => TypeKind::Time,
        Ty::Text(max) => TypeKind::Text { min: None, max, format: None },
        Ty::Ref(table) => TypeKind::Ref { table }, Ty::Enum(variants) => TypeKind::Enum { variants },
        Ty::Decimal(scale) => TypeKind::Decimal { scale }, Ty::Money(currency, scale) => TypeKind::Money { currency, scale },
        Ty::List(item, max) => TypeKind::List { item: Box::new(scalar_type(&item)?), max },
        _ => return None,
    };
    Some(ScalarType { kind, optional: ty.is_optional() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_or_overlapping_repair_offsets_have_no_rewrite() {
        for edits in [vec![(1..2, "x".into())], vec![(0..9, "x".into())],
            vec![(2..0, "x".into())], vec![(0..2, "x".into()), (0..0, "y".into())]] {
            assert_eq!(splice("é", edits), None);
        }
        assert_eq!(splice("é ok", vec![(3..5, "yes".into())]), Some("é yes".into()));
    }
}
