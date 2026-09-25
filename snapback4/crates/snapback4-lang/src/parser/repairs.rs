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
    fn declaration_span(&self, source: &str) -> Option<Range<usize>> {
        let start = self.source_offset(&self.tokens.get(self.declaration_start)?.site)?;
        let mut indent = 0usize;
        let mut delimiters = Vec::new();
        let mut statement_start = false;
        for token in self.tokens.get(self.declaration_start..)? {
            match token.kind {
                Kind::Eof => return delimiters.is_empty().then_some(start..source.len()),
                Kind::Indent => { indent += 1; continue; }
                Kind::Dedent => { indent = indent.checked_sub(1)?; statement_start = true; continue; }
                Kind::Newline => { statement_start = true; continue; }
                _ => {}
            }
            if statement_start && indent == 0 && delimiters.is_empty() {
                return Some(start..self.source_offset(&token.site)?);
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

    pub(super) fn declaration_rewrite(&self, start: usize, end: usize, replacement: &str, argument: Option<(&Site, String)>) -> Option<String> {
        if start >= end { return None; }
        let source = self.source.join("\n");
        let span = self.declaration_span(&source)?;
        let first = self.source_offset(&self.tokens.get(start)?.site)?;
        let finish = self.token_end(self.tokens.get(end.checked_sub(1)?)?, &source)?;
        if first < span.start || finish > span.end { return None; }
        let mut edits = vec![(first.checked_sub(span.start)?..finish.checked_sub(span.start)?, replacement.to_owned())];
        if let Some((site, value)) = argument {
            let at = self.source_offset(site)?;
            if source.get(at..)?.chars().next()? != '(' || at < span.start || at >= first { return None; }
            let at = at.checked_sub(span.start)?.checked_add(1)?;
            edits.push((at..at, value));
        }
        splice(source.get(span)?, edits)
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
