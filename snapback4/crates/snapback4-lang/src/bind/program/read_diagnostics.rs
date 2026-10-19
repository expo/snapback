//! Query result paths and nullable reads of private side tables.
use super::*;

pub(super) const VIEWER_KEY: &str = "$lookupViewerKey";

// @ref LLP 3000.036.002#151-evidence-and-decision — compatibility keeps
// fallthrough null; check must name a concrete uncovered source path.
pub(super) fn fallthrough(decl: &ast::ProgramDecl) -> Diagnostic {
    fn path(body: &[S], implicit: bool) -> Option<Vec<String>> {
        let mut route = Vec::new();
        for (at, stmt) in body.iter().enumerate() {
            match stmt {
                S::Return { .. } => return None,
                S::Expr { .. } if implicit && at + 1 == body.len() => return None,
                S::Require { condition: A::Literal { value: Literal::Bool(false), .. }, .. } => return None,
                S::If { then_body, else_body, site, .. } => {
                    let completes = implicit && at + 1 == body.len();
                    let (arm, rest) = if let Some(rest) = path(then_body, completes) { ("true", rest) }
                        else if let Some(rest) = path(else_body, completes) { ("false", rest) }
                        else { return None };
                    route.push(format!("if at {site} is {arm}")); route.extend(rest);
                }
                S::For { site, .. } => route.push(format!("loop at {site} has zero iterations")),
                _ => {}
            }
        }
        Some(route)
    }
    let route = path(&decl.body, true).unwrap_or_default();
    let route = if route.is_empty() { "entry → end".into() } else { format!("{} → end", route.join(" → ")) };
    Diagnostic::new(&decl.site, "N_QUERY_FALLTHROUGH",
        format!("query {} can finish without a result ({route}); that path returns null", decl.name),
        "return a value on this path: add `return []` for an intentionally empty list, or `return null` for intentional absence; a return inside a possibly empty loop does not cover its zero-iteration path").guide("programs")
}

impl Binder<'_> {
    // This marker suppresses advice only; it cannot authorize a runtime read
    // or enter the binder's authority/presence proof domains.
    pub(super) fn lookup_viewer_key(&self, value: &A) -> bool {
        if matches!(value, A::Name { name, .. } if name == "viewer" || self.binding(name)
            .is_some_and(|binding| binding.fields.contains_key(&vec![VIEWER_KEY.into()]))) { return true; }
        let equal = A::Binary { op: "=".into(), left: Box::new(value.clone()), right: Box::new(A::Name { name: "viewer".into(), site: value.site().clone() }), site: value.site().clone() };
        self.point_guard_safe(value) && self.authorization_proved(&equal, true)
    }
    // @ref LLP 3000.036.002#152-lookup-contract-and-diagnostics — only
    // authored reads get advice; blind write targets never pass this method.
    pub(super) fn optional_lookup_note(&mut self, read: &ReadExpr, point: &Read) {
        if self.caller_kind != ProgramKind::Mutation || self.point_present(read)
            || self.row_independent_read_proved(&read.table) { return; }
        let table = &self.schema.tables[&read.table];
        if table.through.is_some() || table.ephemeral.is_some() || self.schema.maintain_for(&read.table).is_some() { return; }
        let index = &table.indexes[&point.index];
        let pinned = index.components.iter().zip(&point.key).filter_map(|(part, value)| part.column().map(|name| (name, value))).collect();
        if snapback4_core::engine::rules::prefix_visibility(&read.table, table, &table.rules.read, &pinned).decided_true { return; }
        if let Some(rule) = self.catalog.tables[&read.table].decl.rules.iter().find(|rule| rule.effect == ast::Effect::Read) {
            let named = read.keys.iter().all(|key| key.column.is_some());
            let keys: BTreeMap<_, _> = read.keys.iter().enumerate().filter_map(|(at, key)|
                Some((if named { key.column.clone()? } else { index.components.get(at)?.column()?.clone() },
                    if self.lookup_viewer_key(&key.value) { A::Name { name: "viewer".into(), site: key.site.clone() } } else { key.value.clone() }))).collect();
            let mut condition = rule.value.clone();
            super::super::intent_walk::expression(&mut condition, &mut |value| {
                if let A::Member { base, name, .. } = value && matches!(base.as_ref(), A::Focal { .. })
                    && let Some(key) = keys.get(name) { *value = key.clone(); }
            });
            if self.point_guard_safe(&condition) && self.authorization_proved(&condition, true) { return; }
        }
        let rule = table.rules.read.quarry();
        let location = self.catalog.tables[&read.table].decl.rules.iter().find(|rule| rule.effect == ast::Effect::Read)
            .map(|rule| rule.site.to_string()).unwrap_or_else(|| self.catalog.tables[&read.table].decl.site.to_string());
        if self.notes.iter().any(|note| note.code == "N_LOOKUP_FILTERED" && note.site == read.site) { return; }
        self.optional_lookups.insert(read.site.to_string(), read.table.clone());
        self.notes.push(Diagnostic::new(&read.site, "N_LOOKUP_FILTERED",
            format!("mutation {}: optional lookup of {} uses `read <- {rule}` ({location}); its key and preceding guards do not prove read authority. A hidden, expired or missing row returns null, so a later field/default or require may report a different business condition", self.name, read.table),
            "review whether these callers should read this data; use a deliberately readable projection containing only the needed fields, or keep null as intentional absence. An id and a later write rule do not grant read authority; do not widen private rows just to read one field").guide("rules"));
    }
}
