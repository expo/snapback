//! Server-authoritative lower row lifetime, independent of physical expiry.
// @ref LLP 3000.036.002#2-one-lifetime-predicate — every reader shares this half-open lifetime.
use super::*;

impl Table {
    pub fn opens_at(&self, row: &Value) -> Option<i64> {
        let image = row_image(row, self);
        self.not_before
            .as_ref()
            .and_then(|field| image.field(field).ok())
            .and_then(|value| value.as_int().ok())
    }
    pub fn opened(&self, row: &Value, now: i64) -> bool {
        self.opens_at(row).is_none_or(|at| at <= now)
    }
    pub fn live(&self, row: &Value, now: i64) -> bool {
        self.opened(row, now) && !self.expired(row, now)
    }
    pub fn opening_index(&self) -> Option<(&str, &Index)> {
        let column = self.not_before.as_deref()?;
        self.indexes
            .iter()
            .find(|(_, index)| {
                index.is_plain() && index.columns().first().map(String::as_str) == Some(column)
            })
            .map(|(name, index)| (name.as_str(), index))
    }
}

pub(super) fn validate(schema: &Schema, issues: &mut Vec<SchemaIssue>) {
    let timed = |name: &str| {
        schema
            .table(name)
            .is_some_and(|table| table.not_before.is_some())
    };
    for (name, table) in &schema.tables {
        let path = format!("tables.{name}");
        if table.not_before.is_some() && table.ephemeral.is_some() {
            issues.push(SchemaIssue { path: format!("{path}.ephemeral"), message:
                "ephemeral: not before cannot appear on an ephemeral table; keep the scheduled payload in a durable table".into() });
        }
        if let Some(through) = &table.through
            && (table.not_before.is_some() || timed(&through.parent))
        {
            issues.push(SchemaIssue { path: format!("{path}.notBefore"), message:
                format!("not before cannot compose with read through: {name} and {} need one captured opening boundary; use an explicit durable table", through.parent) });
        }
        if table.sync.as_ref().is_some_and(Sync::is_union) {
            let mut scopes = vec![name.as_str()];
            scopes.extend(
                table
                    .sync
                    .as_ref()
                    .into_iter()
                    .flat_map(Sync::arms)
                    .filter_map(|(audience, _)| match audience {
                        Audience::Target { table, .. } => Some(table.as_str()),
                        _ => None,
                    }),
            );
            if let Some(scope) = scopes.into_iter().find(|scope| timed(scope)) {
                issues.push(SchemaIssue { path: format!("{path}.sync"), message:
                    format!("union audiences cannot use a time audience: {scope} has `not before`; use `online only`") });
            }
        }
    }
    for (position, maintain) in schema.maintains.iter().enumerate() {
        if timed(&maintain.source) || timed(&maintain.target) {
            issues.push(SchemaIssue { path: format!("maintains[{position}]"), message:
                format!("maintain {} cannot use `not before` on its source or target until boundary recounts are supported", maintain.target) });
        }
    }
    for timeline in &schema.timelines {
        if let Some(table) = timeline
            .event_tables()
            .into_iter()
            .find(|table| timed(table))
        {
            issues.push(SchemaIssue {
                path: format!("timelines.{}", timeline.name),
                message: format!(
                    "timeline {} cannot map time-audience table {table}; query the table directly",
                    timeline.name
                ),
            });
        }
    }
}
