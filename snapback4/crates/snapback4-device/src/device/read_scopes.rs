//! Private device answer dependencies, before projections erase audience keys.
//! @ref LLP 3000.023#10 — a scope tombstone withdraws only intersecting groups.
use super::*;

impl<T: DeviceTx> history::Reading<'_, T> {
    pub(super) fn scope_row(&self, name: &str, row: &Value) {
        let Some(table) = self.schema.table(name) else { return };
        self.scope_columns(name, table.columns.keys().filter_map(|column| row.field(column).ok().map(|value| (column.as_str(), value))));
    }
    pub(super) fn scope_range(&self, name: &str, index: &str, prefix: &[Value]) {
        let Some(index) = self.schema.table(name).and_then(|table| table.index(index)) else { return };
        self.scope_columns(name, index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|column| (column.as_str(), value))));
    }
    pub(super) fn scope_columns<'a>(&self, name: &str, columns: impl Iterator<Item = (&'a str, &'a Value)> + Clone) {
        let Some(scopes) = self.scopes else { return };
        let Some(table) = self.schema.table(name).filter(|table| table.sync.is_some()) else { return };
        // Missing positions mean the read spans that audience dimension. Null
        // remains a value, so compound/nullable groups cannot alias wildcards.
        let mut group = serde_json::Map::new();
        for (position, column) in audience_prefix(table).iter().enumerate() {
            if let Some((_, value)) = columns.clone().find(|(key, _)| *key == column) {
                group.insert(position.to_string(), wire::to_json(value));
            }
        }
        let group = serde_json::Value::Object(group);
        let mut scopes = scopes.borrow_mut();
        let entries = scopes.as_object_mut().unwrap().entry(name).or_insert_with(|| serde_json::Value::Array(Vec::new())).as_array_mut().unwrap();
        if !entries.contains(&group) { entries.push(group); }
    }
}
