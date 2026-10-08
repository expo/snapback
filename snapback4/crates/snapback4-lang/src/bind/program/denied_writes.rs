//! `N_WRITE_DENIED`: a mutation's write whose table rule for that effect is
//! `deny`, written or omitted, can never pass for any caller but the system.
//! Decided from the schema alone, so it discloses nothing.
use super::*;
use crate::ast::{Effect, RuleDecl};

// @ref LLP 3000.036#3 — one note per effect, and per upsert arm; jobs and maintains run as the system.
impl Binder<'_> {
    pub(super) fn note_denied_write(&mut self, info: &TableInfo, op: &WriteOp, fields: &[ObjectField], site: &Site) {
        if self.caller_kind != ProgramKind::Mutation { return; }
        // Compiler-owned receipt operations write engine-owned progress.
        if self.schema.receipts.iter().any(|family| [&family.delivered, &family.seen, &family.compact].contains(&&self.name)) { return; }
        let table = &info.decl.name;
        // A patch of only `written by` fields is judged by field authority, not
        // the update rule, unless the rule names a transition (old, next).
        // Immutable fields are dropped from a patch against a hidden row, so
        // owned fields beside them can still pass without the update rule.
        let owned = |name: &str| info.decl.columns.iter().any(|column| column.name == name && column.written_by.is_some());
        let immutable = |name: &str| info.decl.immutable.iter().any(|(columns, _)| columns.iter().any(|column| column == name));
        let owned_only = fields.iter().any(|field| !field.spread && owned(&field.name))
            && fields.iter().all(|field| !field.spread && (owned(&field.name) || immutable(&field.name)));
        let transition = info.decl.rules.iter().any(|rule| rule.effect == Effect::Update && !rule.bindings.is_empty());
        // A spread may supply only owned fields; stay silent rather than guess.
        let skips_update = (owned_only || fields.iter().any(|field| field.spread)) && !transition;
        let denied = |effect: Effect| -> Option<String> {
            match info.decl.rules.iter().find(|rule| rule.effect == effect) {
                None => Some(format!("{table} has no `{}` rule ({}), so it is deny", effect.word(), info.decl.site)),
                Some(RuleDecl { value: A::Name { name, .. }, site, .. }) if name == "deny" || name == "false" =>
                    Some(format!("{table} has `{} <- {name}` ({site})", effect.word())),
                Some(RuleDecl { value: A::Literal { value: Literal::Bool(false), .. }, site, .. }) =>
                    Some(format!("{table} has `{} <- false` ({site})", effect.word())),
                // Any other rule, including one whose bind failed (already reported).
                Some(_) => None,
            }
        };
        let operation = format!("`{}`", self.name);
        let (message, rewrite) = match op {
            WriteOp::Update if skips_update => return,
            WriteOp::Insert | WriteOp::Update | WriteOp::Delete => {
                let effect = match op { WriteOp::Insert => Effect::Insert, WriteOp::Update => Effect::Update, _ => Effect::Delete };
                let Some(rule) = denied(effect) else { return };
                (format!("{rule}; the {} at {site} in {operation} cannot pass it for any caller but the system", op.word()),
                    format!("write the {} rule the callers need (`{} <- .<owner> = viewer`), or do this write in a job, which runs as the system", effect.word(), effect.word()))
            }
            WriteOp::Upsert => match (denied(Effect::Insert), if skips_update { None } else { denied(Effect::Update) }) {
                (None, None) => return,
                (Some(rule), None) => (format!("{rule}; the insert arm of the upsert at {site} in {operation} cannot pass it; the update arm can"), "write the insert rule the callers need, or do this write in a job, which runs as the system".to_owned()),
                (None, Some(rule)) => (format!("{rule}; the update arm of the upsert at {site} in {operation} cannot pass it; the insert arm can"), "write the update rule the callers need (an upsert of an existing row is an update), or use insert if the row is always new".to_owned()),
                (Some(insert), Some(update)) => (format!("{insert} and {update}; neither arm of the upsert at {site} in {operation} can pass for any caller but the system"), "write the insert and update rules the callers need, or do this write in a job, which runs as the system".to_owned()),
            },
        };
        if self.notes.iter().any(|note| note.code == "N_WRITE_DENIED" && note.site == *site) { return; }
        self.notes.push(Diagnostic::new(site, "N_WRITE_DENIED", message, rewrite).guide("rules"));
    }
}
