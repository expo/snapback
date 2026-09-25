#![forbid(unsafe_code)]
//! Quarry for Snapback 4: one language for tables, rules and programs
//! (LLP 2000.000 §5.1), bound to the core IR in Rust so `check` runs in
//! milliseconds with no other runtime.

pub mod ast;
pub mod bind;
pub mod diag;
pub mod emit;
pub mod guide;
pub mod lexer;
pub mod parser;
pub mod print;
pub mod source;
pub mod recipe;
pub mod types;

pub use bind::{Bound, BoundProgram, bind};
pub use diag::{Diagnostic, Site};
pub use parser::parse_document;

/// Parse and bind a set of `(file name, source)` documents.
pub fn compile(sources: &[(String, String)]) -> Bound {
    let mut documents = Vec::new();
    let mut diagnostics = Vec::new();
    for (file, source) in sources {
        let (document, mut parsed) = parse_document(file, source);
        diagnostics.append(&mut parsed);
        documents.push(document);
    }
    // Refusals still block binding. On these malformed forms only, complete
    // their repairs with column types/table names from the whole project,
    // including files and declarations that follow the offending operation.
    let repair_files: std::collections::BTreeSet<_> = diagnostics.iter().filter(|d|
        d.code == "E_QUARRY_SELF_EQUALITY" || (d.code == "E_QUARRY_UNSUPPORTED" && d.message.starts_with("count(*)")))
        .map(|d| d.site.file.clone()).collect();
    if !repair_files.is_empty() {
        let tables: Vec<_> = documents.iter().flat_map(|doc| doc.tables.iter().cloned()).collect();
        diagnostics.retain(|d| !repair_files.contains(&d.site.file));
        for ((file, source), document) in sources.iter().zip(&mut documents) {
            if repair_files.contains(file) {
                let (repaired, mut parsed) = parser::parse_with_tables(file, source, tables.clone());
                *document = repaired;
                diagnostics.append(&mut parsed);
            }
        }
    }
    if !diagnostics.is_empty() {
        return Bound { view_types: Default::default(), server: documents.iter().any(|doc| doc.server), schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics, notes: Vec::new() };
    }
    bind(documents)
}
