#!/usr/bin/env python3
"""Install/remove the temporary profiler. Run from repository root before builds."""
from pathlib import Path
import sys, shutil
root = Path('snapback4')
report = root / 'reports/20260930-na-native-acquisition'
backup = root / 'target/na-profile-source'
if len(sys.argv) > 1 and sys.argv[1] == 'restore':
    for p in backup.rglob('*'):
        if p.is_file(): shutil.copyfile(p, root / p.relative_to(backup))
    (root/'crates/snapback4-core/src/na_profile.rs').unlink(missing_ok=True)
    sys.exit()
def edit(rel, change):
    p = root / rel
    saved = backup / rel
    assert not saved.exists(), f'already instrumented: {p}'
    saved.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(p, saved)
    p.write_text(change(p.read_text()))
def once(s, old, new):
    assert s.count(old) == 1, (old, s.count(old))
    return s.replace(old, new)
def guard(name, core=False):
    return f'\n        #[cfg(feature = "{ "sqlite" if core else "native" }")]\n        let _na = { "crate" if core else "snapback4_core" }::na_profile::enter("{name}");'
edit('crates/snapback4-core/src/lib.rs', lambda s: s+'\n#[cfg(feature = "sqlite")]\npub mod na_profile;\n')
shutil.copyfile(report/'profile.rs', root/'crates/snapback4-core/src/na_profile.rs')
def store(s):
    s = once(s, 'pub fn commit(self) -> Result<(), RuntimeError> {', 'pub fn commit(self) -> Result<(), RuntimeError> {'+guard('commit',True))
    anchor = 'fn put_indexed(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>, insert_index: &str) -> Result<u64, RuntimeError> {' if 'fn put_indexed(' in s else 'pub fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {'
    s = once(s, anchor, anchor+guard('put-other',True))
    s = once(s, 'self.tx.prepare_cached(sql)?.execute(params![t, id, data])?;', '{ let _na = crate::na_profile::enter("row-sql"); self.tx.prepare_cached(sql)?.execute(params![t, id, data])?; }')
    s = once(s, 'for crate::rows::IndexWrite { name, before, after } in keys {', 'for crate::rows::IndexWrite { name, before, after } in keys {\n            let _na = crate::na_profile::enter("index-sql");')
    return s
edit('crates/snapback4-core/src/store.rs', store)
edit('crates/snapback4-core/src/store/caps.rs', lambda s: once(s, 'let changes = crate::rows::caps::deltas(table, old, new);', 'let _na = crate::na_profile::enter("cap-counts");\n        let changes = crate::rows::caps::deltas(table, old, new);'))
edit('crates/snapback4-core/src/rows.rs', lambda s: once(s, 'table.indexes.iter().map(|(index_name, index)| {', 'table.indexes.iter().map(|(index_name, index)| {\n        #[cfg(feature = "sqlite")]\n        let _na = crate::na_profile::enter(if index.word_component().is_some() {"word-keys"} else {"ordinary-keys"});'))
def sqlite(s):
    if 'let result = load().and_then(|()| {' in s:
        s = once(s, 'let result = load().and_then(|()| {', 'let result = load().and_then(|()| {'+guard('bulk-sort-install'))
    for name in ['staged_put','staged_delete','staged_after','staged_table_after','staged_clear','clear_rows','meta','set_meta','meta_prefix','delete_meta']:
        # Only the DeviceTx implementation; Store metadata access stays in "other".
        start = s.index('impl DeviceTx')
        at = s.index('    fn '+name+'(', start)
        brace = s.index('{',at)+1
        s = s[:brace] + guard('sqlite-'+name) + s[brace:]
    return s
edit('crates/snapback4-device/src/sqlite.rs', sqlite)
for file, method, name in [('snapshot.rs','pub(super) fn stage<','stage'), ('history.rs','pub(super) fn events(','history-coverage'), ('boundary.rs','    pub fn save(','boundary-save'), ('delivery.rs','pub(super) fn publish<','delivery')]:
    def change(s, method=method, name=name):
        at = s.index('{',s.index(method))+1
        return s[:at]+guard(name)+s[at:]
    edit('crates/snapback4-device/src/device/'+file, change)
def device(s):
    anchor = 'fn apply_publication_inner(&mut self, page: &StreamPage, first: bool) -> Result<(Vec<String>, bool), RuntimeError> {'
    s = once(s, anchor, anchor+guard('apply-other'))
    s = once(s, 'tx.replace_rows(|| {', 'tx.replace_rows(|| {'+guard('publish-rows'))
    return s
edit('crates/snapback4-device/src/device.rs',device)
def call(s):
    start = s.index('    use snapback4_core::json_codec;',s.index('pub fn try_call_text'))
    end = s.index('\n}\n',start)
    body = s[start:end]
    return s[:start]+'''    snapback4_core::na_profile::reset();
    let result = (|| {
    let _na = snapback4_core::na_profile::enter("decode-dispatch");
'''+body+'''\n    })();
    eprintln!("NA_PROFILE {}", snapback4_core::na_profile::report());
    result'''+s[end:]
edit('crates/snapback4-device/src/call.rs',call)
print('temporary instrumentation installed')
