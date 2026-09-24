use super::*;

impl Analysis<'_> {
    pub(super) fn write(&mut self, name: &str, kind: &str, times: u64) {
        let site = format!("{}: {kind} {name}", self.program.name);
        let Some(table) = self.schema.table(name) else { return };
        // Writes include constraint checks, old/new images, derived deltas,
        // prediction authority and partition transitions. Use their shared
        // runtime allowance, rather than pretend the authored row is all work.
        self.meter_allowance();
        let inserting = matches!(kind, "insert" | "upsert");
        if inserting {
            self.rule(&table.rules.insert, &site, times);
            if !table.recorded.is_empty() {
                self.per_write(format!("{name}: {} recorded-attribution point reads per inserted row", table.recorded.len()));
            }
        }
        if kind != "delete" {
            for c in &table.constraints {
                match c {
                    Constraint::Unique { index } if table.expire.is_some() => self.expiry_write(name, index),
                    Constraint::Unique { index } => self.lookup_growth(name, index, &site),
                    Constraint::FinalExistsOnInsert { table, index, .. } => self.lookup_growth(table, index, &site),
                    Constraint::Cap { .. } if table.expire.is_some() => self.per_write(format!(
                        "{name}: cap uses a maintained physical count; unswept expired rows count until removed; no population scan")),
                    _ => {}
                }
            }
        }
        if matches!(kind, "update" | "upsert") { self.rule(&table.rules.update, &site, times); }
        if kind == "delete" { self.rule(&table.rules.delete, &site, times); }
        // Returned write rows may also run the read rule.
        self.rule(&table.rules.read, &site, times);
        let mut visited = BTreeSet::new();
        self.maintained_writes(name, &site, &mut visited);
        for t in &self.schema.timelines {
            if t.maps(name) || t.purge == self.program.name {
                self.per_write(format!("Following `{}` delivery/backfill/removal shares the write meter (sized bounds below)", t.name));
            }
        }
    }

    fn maintained_writes(&mut self, name: &str, site: &str, visited: &mut BTreeSet<String>) {
        if !visited.insert(name.into()) { return; }
        for m in &self.schema.maintains {
            if m.source != name { continue; }
            let count = if m.private.is_some() { 4 } else { 2 };
            self.per_write(format!("`{}`: at most {count} derived writes per source transition (old/new groups)", m.label()));
            if let Some(owner) = &m.private { self.maintained_writes(&owner.table, site, visited); }
        }
    }

    pub(super) fn expiry_write(&mut self, name: &str, index: &str) {
        self.per_write(format!("{name}.{index}: constant full-key lookup plus only expired collisions on the same full key; skipping those collisions is bounded by the examined meter; server expiry sweep: 1-second tick, at most 2,000 rows per pass (backlog, downtime or failures can leave older rows)"));
    }

    fn per_write(&mut self, text: String) {
        if !self.result.per_write.contains(&text) { self.result.per_write.push(text); }
    }
}
