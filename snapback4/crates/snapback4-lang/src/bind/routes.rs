//! Routes live in their own registry; the core synthesizes private durable work.
use super::{actions::bind_work, catalog::Catalog, operation_name};
use crate::diag::{Diagnostic, Site};
use snapback4_core::schema::{RouteSpec, Schema};
use std::collections::BTreeMap;

pub(super) fn bind(catalog: &Catalog, schema: &mut Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut names = BTreeMap::<String, Site>::new();
    let mut paths = BTreeMap::<String, Site>::new();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        for decl in &doc.routes {
            let name = operation_name(module, &decl.name);
            let error = |message, rewrite| Diagnostic::new(&decl.site, "E_ROUTE_DECLARATION", message, rewrite).guide("routes");
            if let Some(first) = names.get(&name) {
                diagnostics.push(error(format!("duplicate route {name}; first declared at {first}"), "rename the route or its module file"));
                continue;
            }
            names.insert(name.clone(), decl.site.clone());
            if let Some(first) = paths.get(&decl.path) {
                diagnostics.push(error(format!("duplicate route path {}; first declared at {first}", decl.path), "give each route its own static absolute path; module names do not change URL paths"));
                continue;
            }
            paths.insert(decl.path.clone(), decl.site.clone());
            let work = match bind_work(&decl.work, &decl.site) {
                Ok(work) => work,
                Err(mut diagnostic) => {
                    diagnostic.code = "E_ROUTE_DECLARATION".into();
                    diagnostic.guide = "routes".into();
                    diagnostics.push(diagnostic);
                    continue;
                }
            };
            let spec = RouteSpec { path: decl.path.clone(), service: decl.service.clone(), work, wait_ms: decl.wait_ms };
            if let Err(message) = spec.validate() {
                diagnostics.push(error(message, "use a unique static path such as /hooks/billing, an explicit service:<seat> when needed, wait 1ms–25s, retry 1–100, backoff 1s–5m and deadline 1s–30d"));
                continue;
            }
            // @ref LLP 3000.009#5.1 — route admission is separate from public action admission and client APIs.
            schema.routes.insert(name, spec);
        }
    }
}
