//! A declaration must fit the same encoded index key on every store.
use super::catalog::Catalog;
use crate::diag::Diagnostic;
use snapback4_core::{Value, key, rows::{MAX_INDEX_KEY_BYTES, MAX_INDEX_LABEL_BYTES}, schema::{ColumnType, IndexComponent, Schema}};

// identity_fits permits at most 135 bytes after JSON escaping; key escaping
// is no larger. Include the key tag and two-byte terminator, even for byId
// (the physical layout appends the identity a second time).
const ID_BYTES: usize = 138;

fn column_bytes(kind: &ColumnType) -> usize {
    match kind {
        ColumnType::Optional(inner) => column_bytes(inner),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => ID_BYTES,
        ColumnType::Text { max } => (*max as usize).saturating_mul(4).saturating_add(3),
        ColumnType::Bytes { max } => (*max as usize).saturating_mul(2).saturating_add(3),
        ColumnType::Enum { variants } => variants.iter().map(|v| key::encode(&[Value::String(v.clone())]).len()).max().unwrap_or(1),
        ColumnType::Bool => 1,
        ColumnType::Int | ColumnType::IntRange { .. } | ColumnType::Decimal { .. } | ColumnType::Money { .. } | ColumnType::Time => 9,
        // The existing schema validator refuses these in an index.
        _ => usize::MAX,
    }
}

// @ref LLP 3000.009#4.3 — bound components, encoding overhead and the id.
pub(super) fn check(catalog: &Catalog, schema: &Schema, diagnostics: &mut Vec<Diagnostic>) {
    for (name, table) in &schema.tables {
        for (index_name, index) in &table.indexes {
            let site = catalog.site_for(&format!("tables.{name}.indexes.{index_name}"));
            let generated = index_name.starts_with("$intent:");
            let origin = if generated {
                let unique = catalog.tables.get(name).is_some_and(|table| table.decl.indexes.iter().any(|index| index.name == *index_name && index.unique));
                format!("{} at {site}", if unique { "unique declaration" } else { "access required by the declaration or read" })
            } else { format!("index {name}.{index_name}") };
            if name.len().saturating_add(index_name.len()) > MAX_INDEX_LABEL_BYTES {
                let rewrite = if generated { "shorten the table or column names to leave space for the portable encoded key" } else { "shorten the table or index name to leave space for the portable encoded key" };
                diagnostics.push(Diagnostic::new(&site, "E_INDEX_KEY_BYTES", format!("table and index labels for {origin} exceed {MAX_INDEX_LABEL_BYTES} combined UTF-8 bytes"), rewrite).guide("indexes"));
            }
            let mut components = Vec::new();
            for component in &index.components {
                match component {
                    IndexComponent::Column(column) => {
                        if let Some(kind) = table.columns.get(column) { components.push((column.clone(), column_bytes(kind))); }
                    }
                    IndexComponent::Calendar(key) => components.push((format!("{}({})", key.function, key.column), 9)),
                    IndexComponent::WordPrefixes { .. } => components.push(("words(..)".into(), snapback4_core::words::MAX_TOKEN_BYTES + 3)),
                    IndexComponent::Contribution(maintain) => {
                        for column in &maintain.by {
                            let bytes = if maintain.computed.contains_key(column) { 9 } else { table.columns.get(maintain.aliases.get(column).unwrap_or(column)).map_or(usize::MAX, column_bytes) };
                            components.push((column.clone(), bytes));
                        }
                    }
                }
            }
            let total = components.iter().fold(ID_BYTES, |n, (_, size)| n.saturating_add(*size));
            if total <= MAX_INDEX_KEY_BYTES { continue; }
            let (column, size) = components.iter().max_by_key(|(_, n)| n).cloned().unwrap_or(("id".into(), ID_BYTES));
            let rest = total.saturating_sub(size);
            let chars = MAX_INDEX_KEY_BYTES.saturating_sub(rest).saturating_sub(3) / 4;
            let alternative = if generated { String::new() } else { format!(", or remove components from {index_name}") };
            diagnostics.push(Diagnostic::new(&site, "E_INDEX_KEY_BYTES",
                format!("{origin} can require {total} encoded bytes; column {name}.{column} exceeds the portable {MAX_INDEX_KEY_BYTES}-byte key budget including the id"),
                format!("bound {column}, for example `{column}: text <={chars}`{alternative}; all components and the appended id must fit {MAX_INDEX_KEY_BYTES} bytes")).guide("indexes"));
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn declared_bounds_cover_unicode_composites_and_unbounded_text() {
        for (columns, accepted) in [
            ("a: text <=400\n  by byA: a", true),
            ("a: text <=4294967295\n  by byA: a", false),
            ("a: text <=500\n  by byA: a", false),
            ("a: text <=250\n  b: text <=250\n  by byAB: a, b", false),
            ("a: text <=4294967295\n  by byWords: words(a), id", true),
        ] {
            let source = format!("table items:\n  {columns}\n  public 'test'\n  online only\n");
            let result = crate::compile(&[("schema.q".into(), source)]);
            assert_eq!(result.diagnostics.is_empty(), accepted, "{:?}", result.diagnostics);
            if !accepted { assert!(result.diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES")); }
        }
        let source = format!("table {}:\n  public 'test'\n  online only\n", "t".repeat(513));
        let result = crate::compile(&[("schema.q".into(), source)]);
        assert!(result.diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES"));
    }
    #[test]
    fn bound_diagnostic_survives_an_independent_schema_error_and_links_indexes() {
        let source = "table items:\n  a: text <=500\n  by byA: a\n  public 'test'\n  online only\ntable broken:\n  by missing: nonexistent\n  public 'test'\n  online only\n";
        let result = crate::compile(&[("schema.q".into(), source.into())]);
        assert!(result.diagnostics.iter().any(|d| d.code == "E_INDEX_KEY_BYTES"), "{:?}", result.diagnostics);
        assert!(result.diagnostics.iter().any(|d| d.code != "E_INDEX_KEY_BYTES"));
        assert_eq!(crate::diag::guide_for("E_INDEX_KEY_BYTES"), "indexes");
    }

}
