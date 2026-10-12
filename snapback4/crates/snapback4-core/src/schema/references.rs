//! Referential actions: what deleting a referenced row does to the rows that
//! name it (`on delete restrict | cascade | set null`).
// @ref LLP 3000.038#2 — every reference between ordinary durable tables carries one action; restrict is the default.
use super::*;
pub use reservations::Price;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnDelete {
    Restrict,
    Cascade,
    SetNull,
    /// The referencing row stays and names a deleted row (the pre-0.5 meaning),
    /// declared on purpose: history, audit trails, contributions that outlive
    /// their target.
    Keep,
}

impl OnDelete {
    pub fn words(self) -> &'static str {
        match self { Self::Restrict => "on delete restrict", Self::Cascade => "on delete cascade", Self::SetNull => "on delete set null", Self::Keep => "on delete keep" }
    }
    /// The actions that write the children, bounded by a cap on the reference.
    pub fn writes(self) -> bool { matches!(self, Self::Cascade | Self::SetNull) }
    /// The actions a delete must consult (every one but `keep`).
    pub fn acts(self) -> bool { self != Self::Keep }
}

/// One action-carrying reference `child.column -> parent`.
#[derive(Clone, Copy, Debug)]
pub struct Referencing<'a> {
    pub child: &'a str,
    pub table: &'a Table,
    pub column: &'a str,
    pub action: OnDelete,
}

/// The prefix of the reference index a live child of `parent` is found under.
pub const REFERENCE_INDEX_PREFIX: &str = "$reference:";
pub fn reference_index_name(column: &str) -> String { format!("{REFERENCE_INDEX_PREFIX}{column}") }

impl Schema {
    /// Whether rows of `name` take part in referential actions, as child or
    /// parent: an ordinary durable application table. Ephemeral rows, engine
    /// derivations and receipt/timeline bookkeeping keep their own lifetimes.
    pub fn actionable(&self, name: &str) -> bool {
        let Some(table) = self.table(name) else { return false };
        table.ephemeral.is_none() && self.maintain_for(name).is_none() && self.private_owner(name).is_none()
            && !self.is_recount_work(name) && !self.timelines.iter().any(|t| t.owns(name))
            && !self.receipts.iter().any(|f| [&f.scope, &f.members, &f.runs].iter().any(|t| t.as_str() == name))
    }

    /// Every reference into `parent` a delete consults (all but `keep`), in
    /// (child, column) order.
    pub fn referencing<'a>(&'a self, parent: &'a str) -> impl Iterator<Item = Referencing<'a>> + 'a {
        self.tables.iter().flat_map(move |(child, table)| table.on_delete.iter().filter_map(move |(column, action)| {
            (action.acts() && matches!(table.columns.get(column).map(ColumnType::required), Some(ColumnType::Ref { table: target }) if target == parent))
                .then_some(Referencing { child, table, column, action: *action })
        }))
    }

    /// A delete of a `parent` row consults its referencing rows, so it needs
    /// read authority on that row (LLP 3000.038 §3 step 1).
    pub fn is_referenced(&self, parent: &str) -> bool { self.referencing(parent).next().is_some() }

    /// The index a reference is probed through: its column first, then the
    /// child's deadline column when the child can expire, so one seek skips an
    /// expired backlog. A `read through` reference uses its child index.
    pub fn reference_index(&self, child: &str, column: &str) -> Option<&str> {
        let table = self.table(child)?;
        if table.through.as_ref().is_some_and(|t| t.reference == column) {
            return table.indexes.contains_key(through::CHILDREN).then_some(through::CHILDREN);
        }
        let deadline = table.expire.as_deref();
        table.indexes.iter().find(|(_, index)| {
            let columns = index.columns();
            index.is_plain() && columns.first().map(String::as_str) == Some(column)
                && deadline.is_none_or(|deadline| columns.get(1).map(String::as_str) == Some(deadline))
        }).map(|(name, _)| name.as_str())
    }

    /// The cap bounding a reference's children: `cap N by <column>` exactly.
    pub fn reference_cap(&self, child: &str, column: &str) -> Option<u32> {
        self.table(child)?.constraints.iter().find_map(|c| match c {
            Constraint::Cap { by, max } if by.len() == 1 && by[0] == column => Some(*max),
            _ => None,
        })
    }

    /// Whether `cap` on `table` skips a group whose reference is null: only a
    /// `set null` reference's own cap does (a null reference has no parent).
    pub fn cap_skips_null(&self, table: &Table, by: &[String], group: &[Value]) -> bool {
        by.iter().zip(group).any(|(column, value)| *value == Value::Null && table.on_delete.get(column) == Some(&OnDelete::SetNull))
    }

    /// The tables a delete of a `parent` row may write through its writing
    /// actions, and the tables its actions read. A function of the schema, so
    /// a commit's touched set never says which of them a delete reached.
    pub fn action_tables(&self, parent: &str) -> ActionTables {
        let mut out = ActionTables::default();
        let mut queue = vec![parent.to_owned()];
        let mut visited = BTreeSet::new();
        while let Some(table) = queue.pop() {
            if !visited.insert(table.clone()) { continue; }
            for r in self.referencing(&table) {
                out.read.insert(r.child.to_owned());
                if r.action.writes() { out.written.insert(r.child.to_owned()); }
                if r.action == OnDelete::Cascade { queue.push(r.child.to_owned()); }
            }
        }
        out
    }

    /// Whether `name` is a table a timeline orders the writes of.
    pub fn timeline_member(&self, name: &str) -> bool {
        self.timelines.iter().any(|t| t.owns(name) || t.maps(name) || t.authors.first().is_some_and(|a| a == name))
    }

    /// The fixed charge a delete of a `parent` row reserves before it probes,
    /// cascades or clears any child. A function of the schema only — caps, the
    /// reference graph, each child's indexes and row size, and each child's
    /// exported source-write price — so a meter, and an `E_BOUND` abort, never
    /// depend on how many (hidden) children exist, and every host charges the
    /// same: a device's projection keeps every table that can carry an action
    /// and every exported price. `None` when the cascade graph from `parent` is
    /// cyclic, a writing reference lacks its cap, or a written child has no
    /// fixed write price.
    // @ref LLP 3000.038#5.1 — the reservation is schema-fixed; LLP 3000.015 §2's law for work shaped by hidden rows.
    pub fn delete_reservation(&self, parent: &str) -> Option<Price> {
        self.reservation_from(parent, &mut Vec::new())
    }

    fn reservation_from(&self, parent: &str, path: &mut Vec<String>) -> Option<Price> {
        if path.iter().any(|seen| seen == parent) { return None; }
        path.push(parent.to_owned());
        let mut price = [0_u64; 7];
        let mut heap = 0_u64;
        for r in self.referencing(parent).collect::<Vec<_>>() {
            let row = crate::engine::row_copy_ceiling(r.table);
            let seeks = if r.table.expire.is_some() { 2 } else { 1 };
            // The probe: bounded seeks (two for an expiring child) at a fixed charge.
            add(&mut price, [seeks * 2, seeks, seeks * 2, 0, 0, 0, 0]);
            heap = heap.max(row.saturating_mul(2));
            if !r.action.writes() { continue; }
            let cap = u64::from(self.reference_cap(r.child, r.column)?);
            let mut unit = self.unit_write(r.child)?;
            heap = heap.max(unit[4]);
            unit[4] = 0;
            if r.action == OnDelete::Cascade {
                let mut nested = self.reservation_from(r.child, path)?;
                heap = heap.max(nested[4]);
                nested[4] = 0;
                add(&mut unit, nested);
            }
            add(&mut price, unit.map(|n| n.saturating_mul(cap)));
        }
        price[4] = heap;
        path.pop();
        Some(price)
    }

    /// One engine write (delete or set-null update) of a `table` row: fetch and
    /// write it, its index entries (a `words(..)` index at its token bound), a
    /// row copy, and the source-write price the engine exports for the table.
    fn unit_write(&self, name: &str) -> Option<Price> {
        let table = self.table(name)?;
        let plan = self.write_reservation(name)?;
        if plan.server_only { return None; }
        let entries = table.indexes.values().map(|index| match index.word_component() {
            Some((_, fields)) => fields.iter().filter_map(|f| table.columns.get(f)).map(|kind| match kind.required() {
                ColumnType::Text { max } => u64::from(*max), _ => 0,
            }).sum::<u64>().min(crate::words::MAX_TOKENS_PER_ROW as u64),
            None => 1,
        }).fold(0_u64, u64::saturating_add);
        let row = crate::engine::row_copy_ceiling(table);
        let mut unit = [4 + 2 * entries, 2 * entries, 1, 1, row.saturating_mul(4), 0, 0];
        for phase in 0..=reservations::VIEW_READ {
            let p = plan.price(phase);
            unit[4] = unit[4].max(p[4]);
            add(&mut unit, [p[0], p[1], p[2], p[3], 0, p[5], p[6]]);
        }
        Some(unit)
    }
}

/// The tables a delete's actions may write or read (`Schema::action_tables`).
#[derive(Clone, Debug, Default)]
pub struct ActionTables {
    pub written: BTreeSet<String>,
    pub read: BTreeSet<String>,
}

/// Whether any rule of any table, or the child's own sync, reads `column` of
/// `child` — directly, as a probe key or equality on `child`, or as a hop.
fn carries_authority(schema: &Schema, child: &str, column: &str) -> bool {
    fn term_reads(term: &RuleTerm, own: bool, child: &str, column: &str) -> bool {
        match term {
            RuleTerm::Field(f) | RuleTerm::OldField(f) | RuleTerm::NextField(f) => own && f == column,
            RuleTerm::Reference { .. } | RuleTerm::ReferenceChain { .. } => {
                (own && term.reference_source().is_some_and(|(c, _)| c == column))
                    || term.references().any(|(table, field)| table == child && field == column)
            }
            RuleTerm::Viewer | RuleTerm::Literal(_) => false,
        }
    }
    fn rule_reads(schema: &Schema, rule: &RuleExpr, own: bool, child: &str, column: &str) -> bool {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => false,
            RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => term_reads(a, own, child, column) || term_reads(b, own, child, column),
            RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().any(|item| rule_reads(schema, item, own, child, column)),
            RuleExpr::Not(inner) => rule_reads(schema, inner, own, child, column),
            RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
                let probes_column = table == child && (equalities.iter().any(|(field, _)| field == column)
                    || schema.table(child).and_then(|t| t.index(index)).is_some_and(|i| i.columns().iter().take(key.len()).any(|c| c == column)));
                probes_column || key.iter().chain(equalities.iter().map(|(_, t)| t)).any(|term| term_reads(term, own, child, column))
            }
        }
    }
    schema.tables.iter().any(|(name, table)| {
        let own = name == child;
        [&table.rules.read, &table.rules.insert, &table.rules.update, &table.rules.delete].iter().any(|rule| rule_reads(schema, rule, own, child, column))
            || table.constraints.iter().any(|c| matches!(c, Constraint::FinalExistsOnInsert { table: target, index, key }
                if (target == child && schema.table(child).and_then(|t| t.index(index)).is_some_and(|i| i.columns().iter().take(key.len()).any(|c| c == column)))
                    || key.iter().any(|term| term_reads(term, own, child, column))))
    })
}

/// Why `column` cannot be cleared by its parent's delete, if it cannot: a
/// value that carries authority or meaning beyond "which parent this row has".
// @ref LLP 3000.038#2.2 — set null never changes any rule's verdict, moves a row between audiences, or rewrites a fact resolved through the reference.
pub fn set_null_refusal(schema: &Schema, name: &str, table: &Table, column: &str) -> Option<String> {
    let audience = table.sync.as_ref().is_some_and(|sync| match &sync.audience {
        Audience::Public => false,
        Audience::Column(c) => c == column,
        Audience::Target { prefix, .. } => prefix.iter().any(|c| c == column),
    } || sync.horizon.as_ref().is_some_and(|h| table.index(&h.by).is_some_and(|i| i.uses_column(column))));
    let maintained = schema.maintains.iter().any(|m| m.source == name && m.by.iter().any(|by| by.trim_start_matches('.').starts_with(&format!("{column}."))));
    if !table.columns.get(column).is_some_and(ColumnType::is_optional) { Some("the reference is required; declare it optional (`?`) or choose cascade".into()) }
    else if table.through.as_ref().is_some_and(|t| t.reference == column) { Some("a read-through reference is required and immutable".into()) }
    else if table.immutable_fields().any(|f| f == column) { Some("the column is immutable".into()) }
    else if table.written_by.contains_key(column) { Some("the column is written by its field owner".into()) }
    else if table.sequences.values().any(|p| p == column) { Some("a sequence counts within it".into()) }
    else if table.recorded.values().any(|r| r.reference == column) || maintained { Some("a recorded or maintained path resolves through it".into()) }
    else if carries_authority(schema, name, column) { Some("a rule reads it, so clearing it would change that rule's verdict; a reference that carries authority chooses cascade, restrict or keep".into()) }
    else if audience { Some("the sync audience or horizon uses it, so clearing it would move the row between partitions".into()) }
    else if table.constraints.iter().any(|c| matches!(c, Constraint::Cap { by, .. } if by.iter().any(|b| b == column) && by.len() != 1)) { Some(format!("a cap groups by it with other columns; its only cap is `cap N by {column}`")) }
    else { None }
}

/// Why rows of `name` cannot be deleted or cleared by another row's delete.
pub fn write_target_refusal(schema: &Schema, name: &str) -> Option<String> {
    let table = schema.table(name)?;
    if table.constraints.iter().any(|c| matches!(c, Constraint::AppendOnly)) { Some(format!("{name} is append only")) }
    else if !table.written_by.is_empty() { Some(format!("{name} has field-owned (`written by`) columns, whose owners the schema singled out")) }
    else if schema.timeline_member(name) { Some(format!("a timeline orders {name}'s writes")) }
    else if schema.write_reservation(name).is_none_or(|plan| plan.server_only) { Some(format!("{name}'s writes have no fixed price, so a cascade into it cannot be reserved")) }
    else { None }
}

fn add(to: &mut Price, price: Price) {
    for (to, price) in to.iter_mut().zip(price) { *to = to.saturating_add(price); }
}

/// Structural admission of `on_delete` (the compiler states each refusal first).
pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = Vec::new();
    for (name, table) in &schema.tables {
        for (column, action) in &table.on_delete {
            let path = format!("tables.{name}.onDelete.{column}");
            let mut fail = |message: String| issues.push(SchemaIssue { path: path.clone(), message });
            let Some(ColumnType::Ref { table: parent }) = table.columns.get(column).map(ColumnType::required) else {
                fail(format!("on delete names {column}, which is not a reference column")); continue;
            };
            if !schema.actionable(name) || !schema.actionable(parent) {
                fail(format!("{name}.{column} -> {parent} cannot carry a delete action: ephemeral, engine-owned and receipt or timeline bookkeeping tables keep their own lifetimes"));
                continue;
            }
            let through = table.through.as_ref().is_some_and(|t| &t.reference == column);
            if action.acts() && schema.reference_index(name, column).is_none() {
                fail(format!("{name}.{column} needs its reference index (leading with {column})"));
            }
            if action.writes() {
                if schema.reference_cap(name, column).is_none() {
                    fail(format!("E_CASCADE_BOUND: {} on {name}.{column} needs `cap N by {column}`", action.words()));
                }
                if let Some(reason) = write_target_refusal(schema, name) {
                    fail(format!("{} on {name}.{column}: {reason}", action.words()));
                }
            }
            match action {
                OnDelete::Keep if through => fail(format!("on delete keep on read-through {name}.{column}: a read-through child lives within its parent")),
                OnDelete::SetNull => if let Some(reason) = set_null_refusal(schema, name, table, column) { fail(format!("on delete set null on {name}.{column}: {reason}")); },
                OnDelete::Cascade if through && table.is_expiring() => fail(format!("on delete cascade on read-through {name}.{column} needs a child that never expires")),
                _ => {}
            }
        }
    }
    for name in schema.tables.keys() {
        if schema.is_referenced(name) && schema.delete_reservation(name).is_none()
            && schema.action_tables(name).written.iter().all(|t| write_target_refusal(schema, t).is_none())
            && schema.referencing(name).all(|r| !r.action.writes() || schema.reference_cap(r.child, r.column).is_some()) {
            issues.push(SchemaIssue { path: format!("tables.{name}"), message: format!("on delete cascade from {name} reaches {name} again; a cascade cannot be cyclic") });
        }
    }
    issues
}
