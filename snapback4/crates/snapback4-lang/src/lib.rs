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
    if !diagnostics.is_empty() {
        return Bound { view_types: Default::default(), server: documents.iter().any(|doc| doc.server), schema: Default::default(), programs: Vec::new(), personas: Vec::new(), diagnostics, notes: Vec::new() };
    }
    bind(documents)
}
