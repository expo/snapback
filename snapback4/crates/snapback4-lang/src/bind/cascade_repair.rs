//! A fitting recipe for the whole delete, evaluated with the engine's prices.
use snapback4_core::schema::{Schema, Constraint, references::{OnDelete, Price}};
use std::collections::BTreeSet;

pub(super) fn reaches(schema:&Schema,root:&str,target:&str)->bool {
    let mut seen=BTreeSet::from([root.to_owned()]);let mut todo=vec![root.to_owned()];
    while let Some(parent)=todo.pop() {
        if parent==target {return true;}
        for r in schema.referencing(&parent) {if r.action==OnDelete::Cascade && seen.insert(r.child.into()) {todo.push(r.child.into());}}
    }
    false
}

// @ref LLP 3000.039#7 — caps share one delete reservation, never a per-child allowance.
pub(super) fn recipe(schema: &Schema, parent: &str, job: bool) -> String {
    let mut targets = BTreeSet::new();
    let mut reached = BTreeSet::from([parent.to_owned()]);
    let mut todo = vec![parent.to_owned()];
    while let Some(table) = todo.pop() {
        for r in schema.referencing(&table) {
            if r.action.writes() { targets.insert((r.child.to_owned(), r.column.to_owned())); }
            if r.action == OnDelete::Cascade && reached.insert(r.child.to_owned()) { todo.push(r.child.to_owned()); }
        }
    }
    let candidate = |cap: u32| {
        let mut trial = schema.clone();
        for (child, column) in &targets {
            // A unique reference already has the tightest possible bound.
            if trial.reference_cap(child, column) == Some(1) { continue; }
            let table = trial.tables.get_mut(child).unwrap();
            let mut found = false;
            for constraint in &mut table.constraints {
                if let Constraint::Cap { by, max } = constraint && by.len() == 1 && &by[0] == column {
                    *max = (*max).min(cap); found = true;
                }
            }
            if !found { table.constraints.push(Constraint::Cap { by: vec![column.clone()], max: cap }); }
        }
        trial.prepare_write_reservations();
        let price = trial.delete_total_reservation(parent)?;
        Some((trial, price))
    };
    let fits = |price: &Price| super::reference_actions::over_ceiling(price, job).is_none();
    let fallback = format!("keep `on delete restrict` and delete the child rows first in a job (`for row in <child>:`), then delete the {parent} row; choose caps only if they are product limits (guide writes)");
    if !candidate(1).is_some_and(|(_, price)| fits(&price)) { return format!("even cap 1 cannot fit this delete's fixed heap/row reservation; {fallback}"); }
    let limits = if job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() };
    let (mut low, mut high) = (1, limits.rows_written.min(limits.examined).min(u64::from(u32::MAX)) as u32);
    while low < high {
        let mid = low + (high - low + 1) / 2;
        if candidate(mid).is_some_and(|(_, price)| fits(&price)) { low = mid; } else { high = mid - 1; }
    }
    let (trial, price) = candidate(low).unwrap();
    let unique=targets.iter().map(|(child,column)|format!("`unique {column}` on {child}")).collect::<Vec<_>>().join(" or ");
    let caps = targets.iter().map(|(child, column)| format!("`cap {} by {column}` on {child}", trial.reference_cap(child, column).unwrap())).collect::<Vec<_>>().join(" and ");
    format!("choose a product limit, not an engine tuning number; the engine allows up to {low} per unbounded edge in this joint recipe. For that limit apply {caps} together: the whole delete (including the root) reserves {} / {} rows written and {} / {} heap bytes, with all indexes, derived writes and event images priced together. Heap = root write heap + retained event images + 384 × (cascade identities + 1 root + 4 child-id slots + largest set-null group) + max(child write heap, four-row child page, read-through probe scratch). A count-maintained source commonly reserves 3 × its rows (the row plus its old and new aggregate groups), not one row per child; for a one-to-one relation use {unique} instead; {fallback}", price[3], limits.rows_written, price[4], limits.heap_bytes)
}
