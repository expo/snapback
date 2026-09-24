//! CLI-only index labels. Canonical schema identities are never modified.
use snapback4_core::schema::{Schema, IndexComponent};
use std::collections::BTreeMap;

pub(crate) fn indexes(schema: &Schema, text: &str, canonical: bool) -> String {
    if canonical { return text.into(); }
    let labels: BTreeMap<_, _> = schema.tables.values().flat_map(|table| table.indexes.iter())
        .filter(|(name, _)| name.starts_with("$intent:"))
        .map(|(name, index)| {
            let mut components = index.components.as_slice();
            if components.len() > 1 && matches!(components.last(), Some(IndexComponent::Column(name)) if name == "id") {
                components = &components[..components.len() - 1];
            }
            let columns = components.iter().map(|component| match component {
                IndexComponent::Column(name) => name.clone(),
                IndexComponent::Calendar(key) => {
                    let mut args = vec![key.column.clone()];
                    if key.function == "bucket" { args.push(format!("{}ms", key.millis)); }
                    if key.offset != 0 { args.push(format!("{}ms", key.offset)); }
                    format!("{}({})", key.function, args.join(", "))
                }
                IndexComponent::WordPrefixes { fields, .. } => format!("words({})", fields.join(", ")),
                IndexComponent::Contribution(_) => "contribution".into(),
            }).collect::<Vec<_>>().join(", ");
            (name.as_str(), format!("index ({columns}), chosen by the planner"))
        }).collect();
    let mut out = String::new();
    let mut chars = text.char_indices().peekable();
    let mut previous = None::<char>;
    while let Some((at, c)) = chars.next() {
        // A builder's quoted literal may itself contain a canonical index
        // name. Preserve literal bytes, including escaped quotes.
        if matches!(c, '\'' | '"') && previous.is_none_or(|p| !p.is_alphanumeric()) {
            out.push(c);
            while let Some((_, next)) = chars.next() {
                out.push(next);
                if next == '\\' {
                    if let Some((_, escaped)) = chars.next() { out.push(escaped); }
                } else if next == c { break; }
            }
        } else if text[at..].starts_with("$intent:") {
            let end = text[at..].char_indices().find(|(_, c)| !c.is_ascii_alphanumeric() && !matches!(c, '$' | ':' | '_'))
                .map_or(text.len(), |(n, _)| at + n);
            let end = at + text[at..end].trim_end_matches(':').len();
            if let Some(label) = labels.get(&text[at..end]) {
                if out.ends_with('.') { out.pop(); out.push_str(" using "); }
                out.push_str(label);
                while chars.peek().is_some_and(|(n, _)| *n < end) { chars.next(); }
            } else { out.push(c); }
        } else if text[at..].starts_with("; synthesized; explicit by") {
            let end = at + "; synthesized; explicit by".len();
            while chars.peek().is_some_and(|(n, _)| *n < end) { chars.next(); }
        } else { out.push(c); }
        previous = Some(c);
    }
    out
}
