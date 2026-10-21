//! SQLite adoption reporting helpers; owned reports live at the neutral port.
pub use crate::store_port::report::{AdoptionReport, ViewBuild};

// @ref LLP 3000.007.001#3.11 — builder output names the parent field, never its private target.
pub(super) fn table_label(schema: &crate::Schema, name: &str) -> String {
    if let Some(maintain) = schema.maintain_for(name) {
        return maintain.label();
    }
    for (prefix, suffix) in [("$basis:", "live basis"), ("$recount:", "recount state")] {
        if let Some(target) = name.strip_prefix(prefix) {
            let target = schema
                .maintain_for(target)
                .map_or_else(|| target.to_owned(), |m| m.label());
            return format!("{target} {suffix}");
        }
    }
    name.to_owned()
}
