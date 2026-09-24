//! Explain residual write tests without lowering them to a private pre-read.
use super::*;

impl<'a> Binder<'a> {
    pub(super) fn extra_write_test(&self, info: &'a TableInfo, write: &A, original: Diagnostic) -> Diagnostic {
        let A::Write { table, keys, site, .. } = write else { return original };
        let read = ReadExpr { computed: Default::default(), order_keys: Vec::new(), table: table.clone(),
            keys: keys.clone(), index: None, range: None, matching: None, filter: None, seeks: Vec::new(), site: site.clone() };
        let Ok(read) = super::super::mixed_keys::read(info, &read, self.catalog) else { return original };
        let read = read.into_owned();
        let keys = &read.keys;
        // Speculate only for an explanation. Mistyped, ambiguous or incomplete
        // keys keep their original error; no setup escapes into the program.
        let mut probe = self.clone();
        if probe.read_value(&read, ReadMode::FilteredPoint, &mut setup::Body::default()).is_err() { return original; }
        let Ok((_, index, _)) = probe.select_index(info, &read, ReadMode::FilteredPoint, &mut setup::Body::default()) else { return original };
        if keys.len() <= index.columns.len() { return original; }
        let positional = !self.catalog.synthesized.contains(&(table.clone(), index.name.clone()))
            && info.indexes.iter().filter(|candidate| candidate.unique && candidate.columns.len() == index.columns.len()
                && !self.catalog.synthesized.contains(&(table.clone(), candidate.name.clone()))).count() == 1;
        let key: Vec<_> = index.columns.iter().map(|column| {
            let mut part = keys.iter().find(|part| part.column.as_ref() == Some(column)).expect("validated named key").clone();
            if positional { part.column = None; }
            part
        }).collect();
        let mut checked = read.clone();
        checked.keys = key.clone();
        checked.keys.extend(keys.iter().filter(|part| !index.columns.contains(part.column.as_ref().expect("named key"))).cloned());
        let mut fixed = write.clone();
        let A::Write { keys, .. } = &mut fixed else { unreachable!() };
        *keys = key;
        Diagnostic::new(site, "E_QUARRY_WRITE_TESTS", "a write target names one row by its key; extra column tests belong in an explicit require",
            format!("require exists {} else NOT_ADMIN\n{}", print::read_expr(&checked), print::expression(&fixed))).guide("writes")
    }
}
