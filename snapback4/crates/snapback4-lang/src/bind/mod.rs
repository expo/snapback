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
    /// Facts the compiler can state that are not errors: a page that is
    /// never `complete` because its read rule is not decided by its prefix.
    pub notes: Vec<Diagnostic>,
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
    let notes = completeness_notes(&schema, &programs);
    Bound { schema, programs, personas, diagnostics, notes }
}

/// A scan whose read rule reads a column the prefix does not pin is
/// `complete: false` on the server whatever it finds (LLP 3000 §7,
/// completeness is a class): say so at compile time, with the index that
/// would decide it, as Snapback 2's structural facts did.
fn completeness_notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs {
        for scan in snapback4_core::ir::scans(&bound.program) {
            let Some(table) = schema.table(&scan.table) else { continue };
            if table.rules.read.is_uniformly_readable() {
                continue;
            }
            let visibility = snapback4_core::engine::rules::scan_visibility(schema, scan);
            if visibility.uniform {
                continue;
            }
            let Some(index) = table.index(&scan.index) else { continue };
            let pinned: std::collections::BTreeSet<String> = index.columns().into_iter().take(scan.prefix.len()).collect();
            let mut used = std::collections::BTreeSet::new();
            table.rules.read.fields(&mut used);
            let unpinned: Vec<String> = used.difference(&pinned).cloned().collect();
            let leading = unpinned.iter().map(|c| c.as_str()).chain(index.columns().iter().skip(scan.prefix.len()).map(String::as_str).map(|s| Box::leak(s.to_owned().into_boxed_str()) as &str)).collect::<Vec<_>>().join(", ");
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    "N_NEVER_COMPLETE",
                    format!("{} {}: the page over {}[..] by {} is never `complete` — the read rule `{}` reads {}, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"", bound.program.kind.word(), bound.program.name, scan.table, scan.index, table.rules.read.quarry(), unpinned.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ")),
                    format!("scan by an index leading with {leading} (`by by{}: {leading}`), or read the page on the device, where the partition holds exactly what the viewer may read", unpinned.iter().map(|c| { let mut cs = c.chars(); cs.next().map(|f| f.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default() }).collect::<String>()),
                )
                .guide("reads"),
            );
        }
    }
    notes
}
