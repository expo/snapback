//! The server opt-in is an authoring boundary, never a schema or wire flag.
use crate::ast::Document;
use crate::diag::{Diagnostic, Site};
use std::collections::BTreeSet;

// @ref LLP 3000.009.000#1 — only actions, routes and action schedules require the opt-in; effects and service seats stay core.
pub(super) fn admit(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) {
    // Like identity, a directive in any loaded module applies project-wide.
    if documents.iter().any(|doc| doc.server) { return; }
    let actions: BTreeSet<_> = documents.iter().flat_map(|doc| {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        doc.actions.iter().map(move |decl| super::operation_name(module, &decl.name))
    }).collect();
    let mut refuse = |site: &Site, form: String| {
        diagnostics.push(Diagnostic::new(site, "E_SERVER_REQUIRED",
            format!("{form} requires use server; add the directive to schema.q"), "use server").guide("actions"));
    };
    for doc in documents {
        for decl in doc.actions.drain(..) { refuse(&decl.site, format!("action {}", decl.name)); }
        for decl in doc.routes.drain(..) { refuse(&decl.site, format!("route {}", decl.name)); }
        doc.schedules.retain(|decl| {
            if !actions.contains(&decl.target) { return true; }
            refuse(&decl.site, format!("schedule {} targeting action {}", decl.name, decl.target));
            false
        });
    }
}
