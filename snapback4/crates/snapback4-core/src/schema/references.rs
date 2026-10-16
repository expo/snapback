//! Referential actions: what deleting a referenced row does to the rows that
//! name it (`on delete restrict | cascade | set null`).
// @ref LLP 3000.039#2 — every reference between ordinary durable tables carries one action; restrict is the default.
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

/// Heap a closure keeps per reached row: its table and id (an id is at most
/// 144 canonical bytes) and the set and queue entries holding them.
pub const CLOSURE_IDENTITY_BYTES: u64 = 384;
/// Child rows a cascade or set-null walk reads per seek (LLP 3000.039 §5.1).
pub const REFERENCE_PAGE: usize = 4;

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
    pub fn referencing<'a>(&'a self, parent: &str) -> Vec<Referencing<'a>> {
        // A plain loop into a vector: iterator adapters monomorphize per call site on the web device.
        let mut out = Vec::new();
        for (child, table) in &self.tables {
            for (column, action) in &table.on_delete {
                if action.acts() && matches!(table.columns.get(column).map(ColumnType::required), Some(ColumnType::Ref { table: target }) if target == parent) {
                    out.push(Referencing { child, table, column, action: *action });
                }
            }
        }
        out
    }

    /// A delete of a `parent` row consults its referencing rows, so it needs
    /// read authority on that row (LLP 3000.039 §3 step 1).
    pub fn is_referenced(&self, parent: &str) -> bool { !self.referencing(parent).is_empty() }

    /// The index a reference is probed through: its column first, then the
    /// child's deadline column when the child can expire, so one seek skips an
    /// expired backlog. A `read through` reference uses its child index.
    pub fn reference_index(&self, child: &str, column: &str) -> Option<&str> {
        let table = self.table(child)?;
        if table.through.as_ref().is_some_and(|t| t.reference == column) {
            return table.indexes.contains_key(through::CHILDREN).then_some(through::CHILDREN);
        }
        // The effective deadline: a read-through child's `$deadline`, else `expire at`.
        let deadline = table.expiry_column();
        table.indexes.iter().find(|(_, index)| {
            let columns = index.columns();
            index.is_plain() && columns.first().map(String::as_str) == Some(column)
                && deadline.is_none_or(|deadline| columns.get(1).map(String::as_str) == Some(deadline))
        }).map(|(name, _)| name.as_str())
    }

    /// The cap bounding a reference's children: `cap N by <column>` exactly,
    /// or one when the reference itself is a plain unique key. A nullable
    /// reference may have many nulls, but a parent delete probes one non-null
    /// parent id, whose unique group still has at most one row.
    pub fn reference_cap(&self, child: &str, column: &str) -> Option<u32> {
        let table = self.table(child)?;
        let declared = table.constraints.iter().find_map(|c| match c {
            Constraint::Cap { by, max } if by.len() == 1 && by[0] == column => Some(*max),
            _ => None,
        });
        let unique = table.indexes.values().any(|index| index.unique && index.is_plain() && index.columns() == [column]).then_some(1);
        declared.into_iter().chain(unique).min()
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
        // What a write of each of those tables writes in turn: the derived
        // destinations `row_changed` names (aggregate targets, maintained-column
        // owners, row-keyed views).
        let derived: Vec<String> = self.maintains.iter().filter(|m| out.written.contains(&m.source) || m.row_key.as_ref().is_some_and(|k| out.written.contains(&k.table)))
            .flat_map(|m| [Some(m.target.clone()), m.private.as_ref().map(|owner| owner.table.clone())]).flatten().collect();
        out.written.extend(derived);
        out.written.retain(|name| self.visible(name));
        // Private derivations disappear from the device's projection; their
        // event envelope is exported with each direct source's write price.
        let sources: Vec<String> = out.written.iter().cloned().collect();
        for source in sources {
            if let Some(events) = self.write_reservation(&source).and_then(|plan| plan.action_events) { out.written.extend(events.tables); }
        }
        out
    }

    /// The order a delete's closure is removed in: a row before any table it
    /// must not outlive — its cascade parent, and its `read through` parent.
    /// A cycle through those edges has no valid order and is refused.
    pub fn deletion_precedes(&self, child: &str, parent: &str) -> bool {
        self.table(child).is_some_and(|t| t.through.as_ref().is_some_and(|through| through.parent == parent))
            || self.referencing(parent).into_iter().any(|r| r.child == child && r.action == OnDelete::Cascade)
    }

    /// A table that reaches itself through cascade and `read through` edges.
    pub fn deletion_cycle(&self) -> Option<String> {
        fn visit<'a>(schema: &'a Schema, name: &'a str, path: &mut Vec<&'a str>, done: &mut BTreeSet<&'a str>) -> Option<String> {
            if path.contains(&name) { return Some(name.to_owned()); }
            if !done.insert(name) { return None; }
            path.push(name);
            for (child, _) in &schema.tables {
                if schema.deletion_precedes(child, name) && let Some(cycle) = visit(schema, child, path, done) { return Some(cycle); }
            }
            path.pop();
            None
        }
        let mut done = BTreeSet::new();
        self.tables.keys().find_map(|name| if self.tables[name].on_delete.values().any(|a| *a == OnDelete::Cascade) || self.is_referenced(name) {
            let mut path = Vec::new();
            visit(self, name, &mut path, &mut done)
        } else { None })
    }

    /// Whether `name` is a table a timeline orders the writes of.
    pub fn timeline_member(&self, name: &str) -> bool {
        self.timelines.iter().any(|t| t.owns(name) || t.maps(name) || t.authors.first().is_some_and(|a| a == name))
    }

    /// The most rows of each table one delete of a `parent` row can reach
    /// through its cascades (its closure), the root included: each cascade
    /// edge multiplies by its cap, and edges into a table add up. `None` when
    /// the cascade graph from `parent` is cyclic or a cascade lacks its cap.
    pub fn closure_bounds(&self, parent: &str) -> Option<Vec<(String, u64)>> {
        // Vectors, not maps: the web device pays for every new collection type.
        let mut reach: Vec<String> = vec![parent.to_owned()];
        let mut edges: Vec<(usize, usize, u64)> = Vec::new();
        let mut at = 0;
        while at < reach.len() {
            let table = reach[at].clone();
            for r in self.referencing(&table) {
                if r.action != OnDelete::Cascade { continue; }
                let cap = u64::from(self.reference_cap(r.child, r.column)?);
                let child = reach.iter().position(|t| t == r.child).unwrap_or_else(|| { reach.push(r.child.to_owned()); reach.len() - 1 });
                edges.push((at, child, cap));
            }
            at += 1;
        }
        // Kahn's order over the reached cascade subgraph; a leftover table is a cycle.
        let mut indegree = vec![0_usize; reach.len()];
        for &(_, child, _) in &edges { indegree[child] += 1; }
        let mut bounds = vec![0_u64; reach.len()];
        bounds[0] = 1;
        let mut ready: Vec<usize> = (0..reach.len()).filter(|&t| indegree[t] == 0).collect();
        let mut done = 0;
        while let Some(table) = ready.pop() {
            done += 1;
            for &(from, child, cap) in edges.iter().filter(|(from, _, _)| *from == table) {
                bounds[child] = bounds[child].saturating_add(bounds[from].saturating_mul(cap));
                indegree[child] -= 1;
                if indegree[child] == 0 { ready.push(child); }
            }
        }
        (done == reach.len()).then(|| reach.into_iter().zip(bounds).collect())
    }

    /// The fixed charge a delete of a `parent` row reserves before it probes,
    /// cascades or clears any row, over every meter: the closure's rows and
    /// their identities, every restrict probe (one seek per closure row, plus
    /// the closure rows it skips), every set-null row, and one engine write of
    /// each, priced from the source-write plan the engine already exports. A
    /// function of the schema only — caps, the reference graph, each table's
    /// indexes and row size, and the exported plans — so a meter, an `E_BOUND`
    /// abort or the physical allowance never depends on how many (hidden) rows
    /// exist, and every host charges alike: a device's projection keeps every
    /// table that can carry an action and every exported price. `None` when the
    /// closure is unbounded (a cycle or a missing cap) or a written table has no
    /// fixed write price. Heap is the closure's identity scratch plus the largest
    /// single row's transient work, plus event images retained until commit.
    // @ref LLP 3000.039#5.1 — the reservation is schema-fixed; LLP 3000.015 §2's law for work shaped by hidden rows.
    pub fn delete_reservation(&self, parent: &str) -> Option<Price> {
        let bounds = self.closure_bounds(parent)?;
        let mut price = [0_u64; 7];
        let mut heap = 0_u64;
        let mut identities = 0_u64;
        let mut gathered = 0_u64;
        let rows_of = |name: &str| bounds.iter().find(|(t, _)| t == name).map_or(0, |(_, n)| *n);
        for (table, n) in &bounds {
            let n = *n;
            if table != parent {
                // Fetched by the closure walk and again, current, before its delete.
                let unit = self.unit_write(table)?;
                heap = heap.max(unit[4]);
                add(&mut price, [unit[0], unit[1], unit[2] + 1, unit[3], 0, unit[5], unit[6]].map(|v| v.saturating_mul(n)));
                identities = identities.saturating_add(n);
                // Before any set-null write, each reached cascade row proves
                // that no physically retained read-through child lies outside
                // the closure. Each child table can skip every reached
                // identity from that table and then inspect one outside
                // witness. Execution performs
                // these probes under reference_prepaid, so their complete
                // schema bound belongs in this outer admission reservation.
                let through_children: Vec<_> = self.children(table).collect();
                let probes_per_row = through_children.iter()
                    .map(|(child, _, _)| rows_of(child).saturating_add(1))
                    .fold(0_u64, u64::saturating_add);
                let probes = n.saturating_mul(probes_per_row);
                add(&mut price, [probes, 0, probes, 0, 0, 0, 0]);
                let outside_heap = through_children.iter()
                    .map(|(name, child, _)| crate::engine::row_copy_ceiling(child).saturating_mul(rows_of(name).saturating_add(1)))
                    .fold(0_u64, u64::saturating_add);
                heap = heap.max(outside_heap);
            }
            for r in self.referencing(table) {
                // A capped walk holds one page of child images per seek.
                let row = crate::engine::row_copy_ceiling(r.table);
                heap = heap.max(row.saturating_mul(REFERENCE_PAGE as u64));
                let seeks = if r.table.expiry_column().is_some() && r.table.through.as_ref().is_none_or(|t| t.reference != r.column) { 2 } else { 1 };
                // A walk over a capped group: a seek per page, and a last, short page per range.
                let walk = |cap: u64| seeks * n + cap.saturating_mul(n) / REFERENCE_PAGE as u64;
                // Every reached row runs the lifetime hook for every through
                // child, including children the closure already cascaded away.
                let through = r.table.through.as_ref().is_some_and(|t| t.reference == r.column);
                if through && table != parent { add(&mut price, [3_u64, 0, 3, 0, 0, 0, 0].map(|v| v.saturating_mul(n))); }
                match r.action {
                    // A read-through child's probe: three seeks per closure row (LLP 3000.014 §6).
                    OnDelete::Restrict if through => {},
                    // One probe per closure row, a row per seek: it may skip the closure
                    // rows that name it (each names one target per reference), then stops
                    // at its first outside witness.
                    OnDelete::Restrict => {
                        let probe = seeks * n + rows_of(r.child) + n;
                        add(&mut price, [2 * probe, probe, seeks * n + rows_of(r.child) + n, 0, 0, 0, 0]);
                    }
                    OnDelete::Cascade => {
                        let pages = walk(u64::from(self.reference_cap(r.child, r.column)?));
                        add(&mut price, [2 * pages, pages, seeks * n, 0, 0, 0, 0]);
                    }
                    OnDelete::SetNull => {
                        let cap = u64::from(self.reference_cap(r.child, r.column)?);
                        gathered = gathered.max(cap);
                        let cleared = cap.saturating_mul(n);
                        let unit = self.unit_write(r.child)?;
                        heap = heap.max(unit[4]);
                        let pages = walk(cap);
                        add(&mut price, [2 * pages, pages, seeks * n, 0, 0, 0, 0]);
                        add(&mut price, [unit[0], unit[1], unit[2] + 1, unit[3], 0, unit[5], unit[6]].map(|v| v.saturating_mul(cleared)));
                    }
                    OnDelete::Keep => {}
                }
            }
        }
        // The root is read again, current, before its own removal.
        price[2] = price[2].saturating_add(1);
        // The closure's identities (table and id) are held until the last
        // delete, with the root's and one page of child ids.
        // A set-null group is gathered whole (at most its cap) before it is cleared.
        price[4] = heap.saturating_add(identities.saturating_add(1 + REFERENCE_PAGE as u64 + gathered).saturating_mul(CLOSURE_IDENTITY_BYTES));
        let mut receiver_steps = 0;
        for (table, _) in &bounds {
            for reference in self.referencing(table) {
                if reference.action.writes() { receiver_steps = receiver_steps.max(self.write_reservation(reference.child)?.action_events?.steps_per_write); }
            }
        }
        price[0] = price[0].saturating_add(price[3].saturating_mul(receiver_steps));
        price[4] = price[4].saturating_add(self.retained_action_heap(parent, price[3])?);
        Some(price)
    }

    /// Diagnostic recipe price: action work plus the root's ordinary write.
    /// Execution retains its existing separate charges for these two terms.
    pub fn delete_total_reservation(&self, parent: &str) -> Option<Price> {
        let mut total = self.delete_reservation(parent)?;
        add(&mut total, self.unit_write(parent)?);
        Some(total)
    }

    /// Event images remain live until commit, after action scratch is released.
    pub fn delete_event_heap(&self, parent: &str) -> Option<u64> {
        self.retained_action_heap(parent, self.delete_reservation(parent)?[3])
    }

    // @ref LLP 3000.039#5.1 — two event images per priced row write, plus bounded keys and audience transitions, retained for the request lifetime.
    fn retained_action_heap(&self, parent: &str, writes: u64) -> Option<u64> {
        let mut per_write = 0;
        for (table, _) in self.closure_bounds(parent)? {
            for reference in self.referencing(&table) {
                if reference.action.writes() {
                    let events = self.write_reservation(reference.child)?.action_events?;
                    per_write = per_write.max(events.heap_per_write);
                }
            }
        }
        Some(writes.saturating_mul(per_write))
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
        // The row copy and every phase's heap are held together until the
        // write's attempt ends (an asset phase beside a column recount): a sum.
        let mut unit = [4 + 2 * entries, 2 * entries, 1, 1, row.saturating_mul(4), 0, 0];
        for phase in 0..=reservations::VIEW_READ {
            add(&mut unit, plan.price(phase));
        }
        // The lifetime hook reserves all child-table witnesses while source
        // phases are still held. Device verification additionally holds the
        // parent and a child scratch image; every host prices the same peak.
        let mut lifetime = 0_u64;
        let mut child_peak = 0_u64;
        for (_, child, _) in self.children(name) {
            let scratch = crate::engine::row_copy_ceiling(child).saturating_mul(3);
            lifetime = lifetime.saturating_add(scratch);
            child_peak = child_peak.max(scratch);
        }
        if lifetime > 0 { unit[4] = unit[4].saturating_add(lifetime).saturating_add(child_peak).saturating_add(row); }
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
// @ref LLP 3000.039#2.2 — set null never changes any rule's verdict, moves a row between audiences, or rewrites a fact resolved through the reference.
pub fn set_null_refusal(schema: &Schema, name: &str, table: &Table, column: &str) -> Option<String> {
    let audience = table.sync.as_ref().is_some_and(|sync| std::iter::once((&sync.audience, sync.horizon.as_ref()))
        .chain(sync.also.iter().map(|arm| (&arm.audience, arm.horizon.as_ref())))
        .any(|(audience, horizon)| match audience {
        Audience::Public => false,
        Audience::Column(c) => c == column,
        Audience::Target { prefix, .. } => prefix.iter().any(|c| c == column),
    } || horizon.is_some_and(|h| table.index(&h.by).is_some_and(|i| i.uses_column(column)))));
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
    else if schema.maintains.iter().filter(|m| m.source == name || m.row_key.as_ref().is_some_and(|k| k.table == name))
        .flat_map(|m| [Some(m.target.as_str()), m.private.as_ref().map(|owner| owner.table.as_str())]).flatten()
        .any(|destination| schema.table(destination).is_some_and(|t| t.sync.is_some() && t.written_by.values().any(|authority| !authority.audience))) {
        Some(format!("{name}'s derived writes deliver private fields, whose recipient authorization has no fixed action price"))
    }
    else if schema.timeline_member(name) { Some(format!("a timeline orders {name}'s writes")) }
    else if schema.maintains.iter().any(|m| m.row_key.as_ref().is_some_and(|k| k.table == name)) { Some(format!("{name} is a row-keyed view's member table, whose writes may recount a group outside any fixed price")) }
    else if schema.maintains.iter().any(|m| m.source == name && matches!(m.kind, MaintainKind::Sum { .. })) { Some(format!("{name} feeds a maintained sum: system work can delete rows despite `delete <- deny`, and a cascade from another parent can reach them; a hidden contribution could push the sum out of range, so whether the delete commits would depend on rows the deleter cannot see")) }
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
            if table.written_by.contains_key(column) {
                fail(format!("{name}.{column} is field-owned; a private value carries no delete action"));
                continue;
            }
            if !schema.actionable(name) || !schema.actionable(parent) {
                fail(format!("{name}.{column} -> {parent} cannot carry a delete action: ephemeral, engine-owned and receipt or timeline bookkeeping tables keep their own lifetimes"));
                continue;
            }
            let through = table.through.as_ref().is_some_and(|t| &t.reference == column);
            if action.acts() && schema.reference_index(name, column).is_none() {
                fail(format!("{name}.{column} needs its reference index (leading with {column})"));
            }
            if action.writes() {
                if delete_reachable(schema, parent) && schema.reference_cap(name, column).is_none() {
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
    if let Some(table) = schema.deletion_cycle() {
        issues.push(SchemaIssue { path: format!("tables.{table}"), message: format!("{table} reaches itself through on delete cascade and read through: no order can delete those rows") });
    }
    // A missing reservation can mean an uncapped dormant descendant. Only
    // the structural graph walk above proves a cycle.
    issues
}

/// @ref LLP 3000.036.002#10 — only a live delete source requires action bounds.
/// Authored/system program deletes are checked separately by IR admission.
pub fn delete_source(schema: &Schema, name: &str) -> bool {
    schema.table(name).is_some_and(|table| table.is_expiring() || table.rules.delete != crate::schema::RuleExpr::Deny)
}

pub fn delete_reachable(schema: &Schema, name: &str) -> bool {
    let mut reached = schema.tables.keys().filter(|name| delete_source(schema, name)).cloned().collect::<BTreeSet<_>>();
    let mut pending = reached.iter().cloned().collect::<Vec<_>>();
    while let Some(parent) = pending.pop() {
        for reference in schema.referencing(&parent) {
            if reference.action == OnDelete::Cascade && reached.insert(reference.child.to_owned()) {
                pending.push(reference.child.to_owned());
            }
        }
    }
    reached.contains(name)
}
