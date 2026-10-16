//! Static proof that a patch preserves every immutable column it supplies.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.036.002#10 — upsert patches obey the same immutable law
    // as update; its insert arm is no reason to admit an unproved overwrite.
    pub(super) fn immutable_patch(&self, info: &TableInfo, key: &WriteKey, patch: &Expr,
        fields: &[ObjectField], site: &Site, prior: &[Stmt]) -> Fallible<()> {
        let Expr::Object(patch) = patch else { return Ok(()) };
        let index = info.indexes.iter().find(|index| index.name == key.index).expect("selected write key");
        for (column, value) in patch {
            if !info.decl.immutable.iter().any(|(fields, _)| fields.contains(column)) { continue; }
            let value = resolve(value, prior, 32);
            let target = key.key.iter().map(|value| resolve(value, prior, 32)).collect::<Vec<_>>();
            let pinned = index.columns.iter().position(|field| field == column)
                .is_some_and(|at| target.get(at) == Some(&value));
            let snapshot = if let Expr::Field { base, name } = &value {
                name == column && match base.as_ref() {
                    Expr::Get(read) => read.table == info.decl.name && (
                        read.index == key.index && read.key.iter().map(|value| resolve(value, prior, 32)).eq(target.iter().cloned())
                        || key.index == "byId" && target == vec![ir::field((**base).clone(), "id")]),
                    _ => false,
                }
            } else { false };
            if !pinned && !snapshot {
                let field_site = fields.iter().find(|field| &field.name == column).map_or(site, |field| &field.site);
                return Err(Diagnostic::new(field_site, "E_QUARRY_IMMUTABLE",
                    format!("{}.{} is immutable; this patch does not prove its value equals the stored row (upsert patches an existing row on conflict)", info.decl.name, column),
                    format!("omit {column} from the patch; set it on insert instead. For create-or-edit, branch on a readable point, insert all initial fields when absent, and update only mutable fields when present")).guide("writes"));
            }
        }
        Ok(())
    }
}

/// Follow current lexical values, preserving volatile captures. A stored row
/// snapshot cannot prove a current value across any intervening write. Branch
/// and loop mutations conservatively stop resolution too.
fn resolve(expr: &Expr, prior: &[Stmt], fuel: usize) -> Expr {
    if fuel == 0 { return expr.clone(); }
    match expr {
        Expr::Variable(name) => {
            for (at, statement) in prior.iter().enumerate().rev() {
                if let Stmt::Let { name: slot, value } | Stmt::Const { name: slot, value } | Stmt::Assign { name: slot, value } = statement
                    && slot == name {
                    if matches!(value, Expr::Input(Input::NewId)) { return Expr::Variable(format!("$immutableCapture:{name}:{at}")); }
                    return resolve(value, &prior[..at], fuel - 1);
                }
                if ir::effects::Effects::writes_in(std::slice::from_ref(statement)) { return expr.clone(); }
                if matches!(statement, Stmt::If { .. } | Stmt::For { .. }) { return expr.clone(); }
            }
            expr.clone()
        }
        Expr::Field { base, name } => ir::field(resolve(base, prior, fuel - 1), name),
        Expr::Get(read) => {
            let mut read = read.clone();
            read.key = read.key.iter().map(|value| resolve(value, prior, fuel - 1)).collect();
            // Source locations do not change point identity.
            read.site.clear();
            Expr::Get(read)
        }
        _ => expr.clone(),
    }
}
