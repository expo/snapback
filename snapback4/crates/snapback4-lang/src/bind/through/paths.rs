//! Authored membership paths lower to the existing captured parent rule.
// @ref LLP 3000.014#2-the-form — the whole parent rule and lifetime are inherited, never a live join.
use super::*;

pub(super) fn reference(info: &TableInfo) -> Option<String> {
    let mut found = None;
    for rule in info.decl.rules.iter().filter(|r| r.effect == Effect::Read) {
        let mut value = rule.value.clone();
        super::super::intent_walk::expression(&mut value, &mut |expr| {
            if let Expr::Member { base, .. } = expr
                && let Expr::Member { base, name, .. } = base.as_ref()
                && matches!(base.as_ref(), Expr::Focal { .. })
            { found.get_or_insert_with(|| name.clone()); }
        });
    }
    found.or_else(|| info.decl.sync.as_ref().and_then(|sync| match &sync.audience {
        SyncAudience::Target { prefix, .. } => prefix.iter().find_map(|p| p.split_once('.').map(|(head, _)| head.to_owned())),
        _ => None,
    }))
}

/// Whether the table asks to inherit its parent's audience: `read through`
/// written out, a dotted `sync to` audience, or a read rule that spells the
/// parent's whole rule through the reference (`exists members[.message.group,
/// viewer]` under `messages`' `exists members[.group, viewer]`). A hop in any
/// other read rule names a narrower audience of its own.
pub(super) fn declares_membership(info: &TableInfo, reference: &str, tables: &BTreeMap<String, TableInfo>) -> bool {
    let read = info.decl.rules.iter().find(|r| r.effect == Effect::Read);
    let mut through = false;
    if let Some(rule) = read {
        let mut value = rule.value.clone();
        super::super::intent_walk::expression(&mut value, &mut |expr| {
            if matches!(expr, Expr::Call { name, .. } if name == "$readThrough") { through = true; }
        });
    }
    let dotted = info.decl.sync.as_ref().is_some_and(|sync| matches!(&sync.audience, SyncAudience::Target { prefix, .. } if prefix.iter().any(|p| p.contains('.'))));
    if through || dotted { return true; }
    let Some(rule) = read else { return true };
    let parent = match info.columns.get(reference) {
        Some(ScalarType { kind: TypeKind::Ref { table }, .. }) => table,
        _ => return true,
    };
    let Some(parent_info) = tables.get(parent) else { return true };
    let parent_rule = match parent_info.decl.rules.iter().find(|r| r.effect == Effect::Read) {
        Some(rule) => rule.value.clone(),
        None => Expr::Name { name: if parent_info.decl.public.is_some() { "allow" } else { "deny" }.into(), site: rule.site.clone() },
    };
    let mut nested = false;
    let mut expanded = parent_rule;
    super::super::intent_walk::expression(&mut expanded, &mut |expr| {
        if matches!(expr, Expr::Call { name, .. } if name == "$readThrough") { nested = true; }
        if let Expr::Member { base, .. } = expr && matches!(base.as_ref(), Expr::Focal { .. }) {
            let site = match base.as_ref() { Expr::Focal { site } => site.clone(), _ => unreachable!() };
            **base = Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: reference.into(), site };
        }
    });
    // An inherited parent spells its rule through captures (`.$message.group`).
    nested || crate::print::expression(&rule.value) == crate::print::expression(&expanded).replace('$', "")
}

pub(super) fn repair(decl: &TableDecl, reference: &str) -> String {
    let immutable = if decl.immutable.iter().any(|(fields, _)| fields.iter().any(|f| f == reference)) { String::new() } else { format!("immutable {reference}\n") };
    let sync = decl.sync.as_ref().map(|sync| {
        let horizon = sync.horizon.as_ref().map(|(n, order)| format!(" last {n} by {order}")).unwrap_or_default();
        format!("\nsync{horizon}")
    }).unwrap_or_default();
    format!("{immutable}read through .{reference}{sync}")
}

pub(super) fn check_rule(info: &TableInfo, reference: &str, inherited: &Expr) -> Result<(), Diagnostic> {
    let rule = info.decl.rules.iter().find(|r| r.effect == Effect::Read);
    if rule.is_some_and(|r| matches!(&r.value, Expr::Call { name, .. } if name == "$readThrough")) { return Ok(()); }
    let mut expanded = inherited.clone();
    super::super::intent_walk::expression(&mut expanded, &mut |expr| {
        if let Expr::Member { base, name, .. } = expr && matches!(base.as_ref(), Expr::Focal { .. }) {
            *name = name.replace('$', "");
        }
    });
    if rule.is_some_and(|r| crate::print::expression(&r.value) == crate::print::expression(&expanded)) { return Ok(()); }
    Err(Diagnostic::new(rule.map(|r| &r.site).unwrap_or(&info.decl.site), "E_READ_THROUGH",
        format!("{}: a membership path must spell the whole parent's read rule: {}; inheriting also adopts the parent's lifetime. `read through` admits every reader of the parent, which is not this rule's audience: use it only if all of them may read these rows", info.decl.name, crate::print::expression(&expanded)),
        repair(&info.decl, reference)).guide("sync"))
}

pub(super) fn sync(decl: &mut TableDecl, reference: &str, captures: &BTreeMap<String, ScalarType>) -> Result<(), Diagnostic> {
    let rewrite = repair(decl, reference);
    if let Some(sync) = &mut decl.sync && let SyncAudience::Target { prefix, .. } = &mut sync.audience {
        for path in prefix.iter_mut().filter(|p| p.contains('.')) {
            let Some(field) = captures.keys().find(|field| field.replace('$', "") == *path) else {
                return Err(Diagnostic::new(&sync.site, "E_READ_THROUGH", format!(".{path} is not an audience field captured by read through .{reference}"), rewrite).guide("sync"));
            };
            *path = field.clone();
        }
    }
    Ok(())
}
