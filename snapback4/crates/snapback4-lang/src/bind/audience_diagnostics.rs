//! Authoring context for an aggregate's inherited audience; never changes admission.
use crate::{ast::{Document, MaintainDecl}, diag::{Diagnostic, Site}};
use snapback4_core::schema::{Audience, Schema};

pub(crate) fn sync_syntax(name: &str, source: &str, site: &Site) -> Diagnostic {
    Diagnostic::new(site, "E_QUARRY_SYNTAX",
        format!("view {name} cannot declare a separate sync audience; it inherits from {source}"),
        "remove this sync line to inherit, or replace it with `online only`").guide("maintains")
}

// @ref LLP 3000.028#4-put-the-rules-where-the-builder-meets-them — explain both failed edits with the resolved source audience, even across files.
pub(crate) fn parser_context(documents: &[Document], diagnostics: &mut [Diagnostic]) {
    let maintains: Vec<_> = documents.iter().flat_map(|doc| &doc.maintains).filter(|m|
        diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX" && d.site.file == m.site.file
            && d.message == sync_syntax(&m.name, &m.source, &d.site).message)).collect();
    if maintains.is_empty() { return; }
    // Parsing already refused the sync line. Resolve only declarations, using
    // the ordinary planner/inference; no operation is admitted or executed.
    let mut declarations = documents.to_vec();
    for doc in &mut declarations {
        doc.programs.clear(); doc.actions.clear(); doc.routes.clear(); doc.schedules.clear();
    }
    let bound = super::bind(declarations);
    for maintain in maintains {
        for diagnostic in diagnostics.iter_mut().filter(|d| d.code == "E_QUARRY_SYNTAX"
            && d.site.file == maintain.site.file
            && d.message == sync_syntax(&maintain.name, &maintain.source, &d.site).message) {
            if let Some(context) = public_conflict(&bound.schema, maintain, &diagnostic.site, "E_QUARRY_SYNTAX") {
                *diagnostic = context;
            }
        }
    }
}

pub(super) fn public_conflict(schema: &Schema, maintain: &MaintainDecl, site: &Site, code: &str) -> Option<Diagnostic> {
    let target = schema.tables.get(&maintain.name)?;
    let sync = target.sync.as_ref()?;
    if target.residency.inherited_from.as_deref() != Some(&maintain.source)
        || sync.audience != Audience::Public || sync.horizon.is_some() { return None; }
    let read = maintain.read.as_ref()?;
    if target.rules.read.is_uniformly_readable() { return None; }
    Some(Diagnostic::new(site, code,
        format!("{} inherits horizon-free public sync (`sync public`, no horizon) from {}; its explicit `read <- {}` (at {}) conflicts with that public audience. A maintained view cannot declare a separate sync audience",
            maintain.name, maintain.source, crate::print::with_source(&read.value, &|_| None), read.site),
        format!("{}{}keep `read <- allow` (or omit read) to retain this public offline summary: every device receives every group, including other viewers' keys; use `online only` to keep the narrower read on the server and lose offline aggregate/absence coverage. For viewer-owned existence on an eligible public window, use source owner-key coverage with ordinary `exists` instead of this summary; this does not supply aggregate totals. Measure replica rows and bytes with `snapback4 test --residency`; guide maintains; guide offline-interactions",
            owner_rewrite(schema, maintain).unwrap_or_default(),
            if code == "E_QUARRY_SYNTAX" { "remove the view's sync line, then " } else { "" })).guide("maintains"))
}

fn owner_rewrite(schema: &Schema, maintain: &MaintainDecl) -> Option<String> {
    use snapback4_core::schema::{RuleExpr, RuleTerm, own_keys};
    if maintain.filter.is_some() || maintain.aggregate != "count" { return None; }
    let owner = match &schema.tables.get(&maintain.name)?.rules.read {
        RuleExpr::Eq(RuleTerm::Field(owner), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(owner)) => owner,
        _ => return None,
    };
    let source = schema.tables.get(&maintain.source)?;
    own_keys::keys(source, owner).ok()?;
    let horizon = source.sync.as_ref()?.horizon.as_ref()?;
    let order = source.indexes.get(&horizon.by)?.columns().iter().map(|f| format!(".{f}")).collect::<Vec<_>>().join(", ");
    let key = source.indexes.values().find(|i| i.unique && i.columns().contains(owner) && i.columns().len() == maintain.by.len() && i.columns().iter().all(|f| maintain.by.contains(f)))?.columns();
    let args = key.iter().map(|f| if f == owner { "viewer".to_owned() } else { f.clone() }).collect::<Vec<_>>().join(", ");
    Some(format!("For own-state existence, replace {} with `sync public last {} by {order} with own keys .{owner}` on {}, and replace its Boolean lookups with `exists {}[{args}]`; remove the summary's declaration and read/sync lines. This keeps the public window and supplies complete own-key absence offline. For aggregate totals instead: ", maintain.name, horizon.last, maintain.source, maintain.source))
}
