//! File-qualified helper calls lower to the same global declaration before
//! planner/provenance analysis. Qualification never creates a second helper.
use crate::{ast::*, diag::Diagnostic, print};
use std::{collections::BTreeMap, path::Path};

pub(super) fn normalize(documents: &mut [Document], diagnostics: &mut Vec<Diagnostic>) {
    let owners: BTreeMap<_, _> = documents.iter().flat_map(|doc| {
        let module = Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        doc.functions.iter().map(move |f| (f.name.clone(), module.to_owned()))
    }).collect();
    let mut visit = |value: &mut Expr| {
        let Expr::Call { name, args, site } = value else { return; };
        let Some((module, helper)) = name.split_once('.') else { return; };
        let Some(owner) = owners.get(helper) else { return; };
        if module != owner {
            diagnostics.push(Diagnostic::new(site, "E_QUARRY_UNKNOWN",
                format!("helper {helper} is declared in {owner}.q, not {module}.q"),
                format!("{owner}.{helper}({})", args.iter().map(print::expression).collect::<Vec<_>>().join(", "))).guide("programs"));
        }
        *name = helper.to_owned();
    };
    for doc in documents {
        super::intent_walk::document(doc, &mut visit);
        for view in &mut doc.views {
            for branch in &mut view.branches {
                if let Some(p) = &mut branch.predicate { super::intent_walk::expression(p, &mut visit); }
                super::intent_walk::shape(&mut branch.fields, &mut visit);
            }
        }
    }
}
