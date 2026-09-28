//! One explicit source policy; the application retains its ordinary exists body.
use super::catalog::Catalog;
use crate::diag::Diagnostic;
use snapback4_core::{ir::{Expr, Input, Read}, schema::{self as core, own_keys}};

pub(super) fn lower(catalog: &Catalog, schema: &mut core::Schema, diagnostics: &mut Vec<Diagnostic>) {
    for info in catalog.tables.values() {
        let Some(sync) = &info.decl.sync else { continue; };
        let Some(owner) = &sync.own_keys else { continue; };
        let source = &info.decl.name;
        let by = match own_keys::keys(&schema.tables[source], owner) {
            Ok(by) if !catalog.maintains.contains_key(source) => by,
            result => {
                diagnostics.push(Diagnostic::new(&sync.site, "E_SYNC", result.err().unwrap_or_else(|| "own keys requires an ordinary source table".into()),
                    "use a non-expiring public window, an immutable unique owner key, and caller-owned writes; omit with own keys to keep ordinary window coverage").guide("sync"));
                continue;
            }
        };
        let target = own_keys::target(source);
        let table = own_keys::projection(&schema.tables[source], owner, &by);
        schema.tables.get_mut(source).unwrap().indexes.insert(own_keys::OWNER_INDEX.into(), core::Index::of(&by.iter().map(String::as_str).collect::<Vec<_>>(), false));
        schema.tables.insert(target.clone(), table);
        schema.maintains.push(core::Maintain {
            own_keys: Some(owner.clone()), row_key: None, parent_key: None, private: None,
            aliases: Default::default(), filter: None, computed: Default::default(), residency: Default::default(),
            kind: core::MaintainKind::Count, source: source.clone(), by, target, readable: None,
        });
    }
}

// @ref LLP 3000.028#3.4 — the compiler proves equality to the caller; another principal's miss stays unknown.
pub(super) fn existence(schema: &core::Schema, read: &mut Read) {
    let Some(m) = schema.maintains.iter().find(|m| m.source == read.table && m.own_keys.is_some()) else { return; };
    let index = &schema.tables[&read.table].indexes[&read.index];
    let columns = index.columns();
    if !index.unique || columns.len() != read.key.len() || columns.len() != m.by.len() { return; }
    let Some(owner) = columns.iter().position(|f| Some(f) == m.own_keys.as_ref()) else { return; };
    if read.key[owner] != Expr::Input(Input::Viewer) { return; }
    let Some(key) = m.by.iter().map(|f| columns.iter().position(|c| c == f).map(|i| read.key[i].clone())).collect::<Option<Vec<_>>>() else { return; };
    read.table = m.target.clone();
    read.index = "byGroup".into();
    read.key = key;
}
