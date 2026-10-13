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

/// The audience-grant refusals of the core's sync check, gathered per
/// audience table and reported once at its insert (or update) rule with the
/// repaired rule, instead of once per synced table at each `sync` line.
// @ref LLP 3000.036.000#2.2 — the refusal sits where the edit goes and prints the conjunction to add.
#[derive(Default)]
pub(crate) struct Grants {
    /// (audience table, update) -> the synced tables it governs.
    found: std::collections::BTreeMap<(String, bool), Vec<String>>,
}

impl Grants {
    pub(crate) fn take(&mut self, issue: &snapback4_core::schema::SchemaIssue) -> bool {
        let Some(content) = issue.path.strip_prefix("tables.").and_then(|path| path.strip_suffix(".sync")) else { return false };
        let (target, update) = if let Some((target, _)) = issue.message.split_once(" grants the private audience of ") { (target, false) }
            else if let Some((target, _)) = issue.message.split_once(" can retarget the private audience of ") { (target, true) }
            else { return false };
        self.found.entry((target.to_owned(), update)).or_default().push(content.to_owned());
        true
    }

    pub(crate) fn diagnostics(self, schema: &Schema, catalog: &super::catalog::Catalog) -> Vec<Diagnostic> {
        use snapback4_core::schema::{audience_binding, audience_grant_repair};
        let mut out = Vec::new();
        for ((target, update), contents) in self.found {
            let site = catalog.site_for(&format!("tables.{target}.rules.{}", if update { "update" } else { "insert" }));
            let binding = contents.iter().find_map(|content| {
                let table = schema.table(content)?;
                audience_binding(schema, content, table, table.sync.as_ref()?).ok()
            });
            let Some(binding) = binding else { continue };
            let Some(repair) = audience_grant_repair(schema, &target, &binding, update) else { continue };
            let probe = format!("exists {target}[{}viewer]", binding.columns.iter().map(|column| format!(".{column}, ")).collect::<String>());
            let synced = contents.join(", ");
            let roster = if binding.columns.is_empty() { " The roster has no group columns, so it is one group: a caller already in it may add others, and the first production member is added by a trusted service-seat mutation (fixtures and `/seed` are dev-only)." } else { "" };
            let (message, rewrite) = if update {
                (format!("{target} can retarget the private audience of {synced}: an update that changes {} on {target} moves a grant, so make those columns immutable or guard every update branch with an independent grant probe `{probe}`",
                    binding.columns.iter().chain([&binding.principal]).cloned().collect::<Vec<_>>().join(", ")),
                 format!("immutable {}  -- or: {}", binding.columns.iter().chain([&binding.principal]).cloned().collect::<Vec<_>>().join(", "), repair.rule))
            } else {
                let branches = repair.unguarded.iter().map(|branch| format!("`{branch}`")).collect::<Vec<_>>().join(", ");
                (format!("{target} grants the private audience of {synced}: each {target} row delivers its group's rows to its {}, so every insert rule branch needs an independent grant probe in {target}, `{probe}` (the caller already holds this group), or a `created` probe for a group this mutation made; {branches} proves neither, so a caller could grant access it does not hold ({}). This also governs insert if absent and upsert.{roster}", binding.principal,
                    if repair.unguarded.iter().any(|branch| branch.contains("exists ")) { "a probe of another table, such as ownership of the group's parent row, is not membership: conjoin the grant probe".to_owned() }
                    else { format!("`.{} = viewer` alone lets anyone join", binding.principal) }),
                 match &repair.created {
                     Some(created) => format!("{}  -- and add `{created}` so the mutation that creates the group can add its first member", repair.rule),
                     None => repair.rule.clone(),
                 })
            };
            let rewrite = if !update && binding.columns.is_empty() {
                // @ref LLP 3000.036.002#2 — replace the unsafe branch with a trusted bootstrap.
                let info = &catalog.tables[&target];
                let authored: Vec<_> = info.decl.columns.iter().filter(|column| column.maintained.is_none()).collect();
                let writable: Vec<_> = authored.iter().copied().filter(|column| column.sequence.is_none()).collect();
                let fields = authored.iter().map(|column| format!("  {}: {}", column.name, column.sequence.as_ref().map(|scope| format!("sequence by {scope}")).unwrap_or_else(|| crate::print::scalar_type(&column.type_)))).collect::<Vec<_>>().join("\n");
                let args = writable.iter().map(|column| format!("{}: {}", column.name, crate::print::scalar_type(&column.type_))).collect::<Vec<_>>().join(", ");
                let payload = writable.iter().map(|column| column.name.clone()).collect::<Vec<_>>().join(", ");
                let residency = if schema.tables[&target].sync.is_some() { "sync" } else { "online only" };
                let mut letters = target.chars();
                let operation = format!("grant{}{}", letters.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default(), letters.as_str());
                format!("{rewrite}; for a production staff roster, replace its insert rule with `insert <- viewer = 'service:ops' or {probe}`. A minimal roster recipe using your writable fields is below; apply it in the existing schema, retaining referenced tables, other constraints and write rules:\n\nuse identity password\ntable {target}:\n{fields}\n  unique {}\n  immutable {}\n  read <- {} or viewer = 'service:ops'\n  insert <- viewer = 'service:ops' or {probe}\n  {residency}\n\nmutation {operation}({args}):\n  return insert {target} {{ {payload} }}\n\nMint `snapback4 token --service ops --release ./deployment` locally against that store; call {operation} with the signed-up account principal and its bearer seat token. Service grants add no device audience (guide deploy).",
                    binding.principal, binding.principal, schema.tables[&target].rules.read.quarry())
            } else { rewrite };
            let diagnostic = Diagnostic::new(&site, "E_SYNC", message, rewrite).guide("sync");
            out.push(if !update && binding.columns.is_empty() {
                diagnostic.source_rewrite(crate::diag::SourceRewriteKind::MembershipBootstrap,
                    format!("insert <- viewer = 'service:ops' or {probe}"))
            } else { diagnostic });
        }
        out
    }
}
