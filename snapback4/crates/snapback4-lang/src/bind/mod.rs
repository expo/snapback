//! Binding: documents in, a core schema and typed programs out, with every
//! problem as a located diagnostic.

pub mod catalog;
pub mod program;
pub mod schema;

use crate::ast::Document;
use crate::diag::Diagnostic;
use catalog::Catalog;
pub use program::BoundProgram;
use snapback4_core::schema::Schema;

pub struct Bound {
    pub schema: Schema,
    pub programs: Vec<BoundProgram>,
    pub personas: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn bind(documents: Vec<Document>) -> Bound {
    let mut diagnostics = Vec::new();
    let personas: Vec<String> = documents.iter().flat_map(|d| d.personas.iter().cloned()).collect();
    let catalog = Catalog::build(documents, &mut diagnostics);
    let schema = schema::bind_schema(&catalog, &mut diagnostics);
    let mut programs = Vec::new();
    let mut names = std::collections::BTreeSet::new();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "schema".into());
        for decl in &doc.programs {
            if !names.insert(decl.name.clone()) {
                diagnostics.push(crate::diag::unknown(&decl.site, format!("duplicate operation {}", decl.name), "rename one operation"));
                continue;
            }
            if let Some(bound) = program::Binder::bind(&catalog, &module, decl, &mut diagnostics) {
                programs.push(bound);
            }
        }
    }
    Bound { schema, programs, personas, diagnostics }
}
