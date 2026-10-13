//! Server-authoritative lower row lifetime, independent of physical expiry.
// @ref LLP 3000.036.002#2-one-lifetime-predicate — every reader shares this half-open lifetime.
use super::*;

/// One opening is one system commit. Structural admission keeps that commit
/// inside the ordinary engine heap and event-count envelopes before any row
/// can enter the pending ledger.
pub(crate) const MAX_OPENING_EVENTS: u64 = 1_024;
pub(crate) const MAX_OPENING_BYTES: u64 = 16 << 20;

impl Table {
    /// Reads must classify/filter stored images before public actual-size
    /// accounting whenever either lifetime edge can hide one.
    pub fn read_lifetime_sensitive(&self) -> bool {
        self.not_before.is_some() || self.is_expiring()
    }

    pub fn opens_at(&self, row: &Value) -> Option<i64> {
        self.not_before
            .as_ref()
            .and_then(|field| match row.field(field) {
                Ok(Value::Int(at)) => Some(*at),
                Ok(_) => None,
                Err(_) => match self.defaults.get(field) {
                    Some(ColumnDefault::Literal(Value::Int(at))) => Some(*at),
                    _ => None,
                },
            })
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
        if table.not_before.is_some() {
            let own = table
                .sync
                .as_ref()
                .map_or(0, |sync| sync.arms().count() as u64)
                + table
                    .written_by
                    .values()
                    .filter(|authority| !authority.audience)
                    .count() as u64;
            let memberships = schema.tables.values().flat_map(|content| content.sync.iter().flat_map(Sync::arms))
                .filter(|(audience, _)| matches!(audience, Audience::Target { table: target, .. } if target == name))
                .count() as u64;
            let events = own.saturating_add(memberships);
            let owner_slots = table
                .written_by
                .values()
                .filter(|authority| !authority.audience)
                .count() as u64;
            let mut read_probes = Vec::new();
            crate::engine::rules::probe_sites(&table.rules.read, &mut read_probes);
            // The opening row is decoded before publication, including for an
            // online-only table which emits no event. A join carries a subset
            // of that row's bounded fields plus less framing than this same
            // envelope. Reserve at least the base decode and one envelope for
            // every possible event.
            let bytes = crate::rows::disclosed::decode_reservation(table)
                .saturating_mul(events.max(1));
            if events > MAX_OPENING_EVENTS || bytes > MAX_OPENING_BYTES {
                issues.push(SchemaIssue { path: format!("{path}.notBefore"), message: format!(
                    "not before opening fanout is too large for one bounded publication commit ({events} events, {bytes} reserved bytes); split this audience into smaller tables"
                ) });
            }
            // Opening runs as the system principal, so its recipient-specific
            // private-field projection cannot safely borrow the caller's
            // bounded authorization walk or scratch. Keep that projection
            // local to the opening row; ordinary rows may still use witnesses.
            if owner_slots > 0 && !read_probes.is_empty() {
                issues.push(SchemaIssue { path: format!("{path}.notBefore"), message: format!(
                    "not before with private `written by` fields needs a probe-free read rule so opening publication has no unbounded witness walk; use local field comparisons, declare the fields readable by audience, or remove `not before`"
                ) });
            }
        }
    }
    for (position, maintain) in schema.maintains.iter().enumerate() {
        let timed_row_key = maintain
            .row_key
            .as_ref()
            .is_some_and(|row_key| timed(&row_key.table));
        if timed(&maintain.source) || timed(&maintain.target) || timed_row_key {
            issues.push(SchemaIssue { path: format!("maintains[{position}]"), message:
                format!("maintain {} cannot use `not before` on its source, target, or row-key member table until boundary recounts are supported", maintain.target) });
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
