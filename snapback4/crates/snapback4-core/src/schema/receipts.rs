use serde::{Deserialize, Serialize};
// @ref LLP 3000.022#14 — names and mappings are explicit; v3 owns allocation and membership snapshots.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReceiptFamily {
    pub scope: String,
    pub counter: String,
    pub messages: String,
    pub message_group: String,
    pub position: String,
    pub sender: String,
    pub count: String,
    pub floor: String,
    pub name: String,
    pub members: String,
    pub group: String,
    pub principal: String,
    pub runs: String,
    pub run_group: String,
    pub delivered_field: String,
    pub seen_field: String,
    pub delivered: String,
    pub seen: String,
    pub compact: String,
}

// Reuse the schema's streaming String decoder instead of another field enum.
impl<'de> Deserialize<'de> for ReceiptFamily {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Family;
        impl<'de> serde::de::Visitor<'de> for Family {
            type Value = ReceiptFamily;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a named receipt family")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                const NAMES: [&str; 19] = [
                    "scope",
                    "counter",
                    "messages",
                    "message_group",
                    "position",
                    "sender",
                    "count",
                    "floor",
                    "name",
                    "members",
                    "group",
                    "principal",
                    "runs",
                    "run_group",
                    "delivered_field",
                    "seen_field",
                    "delivered",
                    "seen",
                    "compact",
                ];
                let mut fields: [String; 19] = Default::default();
                let mut seen = 0_u32;
                while let Some(key) = map.next_key::<String>()? {
                    let Some(i) = NAMES.iter().position(|n| *n == key) else {
                        let _ = map.next_value::<serde::de::IgnoredAny>()?;
                        continue;
                    };
                    if seen & (1 << i) != 0 {
                        return Err(serde::de::Error::custom("duplicate receipt mapping"));
                    }
                    seen |= 1 << i;
                    fields[i] = map.next_value()?;
                }
                if seen != (1 << 19) - 1 {
                    return Err(serde::de::Error::custom("incomplete receipt mappings"));
                }
                let [
                    scope,
                    counter,
                    messages,
                    message_group,
                    position,
                    sender,
                    count,
                    floor,
                    name,
                    members,
                    group,
                    principal,
                    runs,
                    run_group,
                    delivered_field,
                    seen_field,
                    delivered,
                    seen,
                    compact,
                ] = fields;
                Ok(ReceiptFamily {
                    scope,
                    counter,
                    messages,
                    message_group,
                    position,
                    sender,
                    count,
                    floor,
                    name,
                    members,
                    group,
                    principal,
                    runs,
                    run_group,
                    delivered_field,
                    seen_field,
                    delivered,
                    seen,
                    compact,
                })
            }
        }
        deserializer.deserialize_map(Family)
    }
}

impl ReceiptFamily {
    pub fn assigned<'a>(&'a self, table: &str) -> impl Iterator<Item = &'a str> {
        [
            (self.scope.as_str(), self.counter.as_str()),
            (&self.members, &self.floor),
            (&self.messages, &self.position),
            (&self.messages, &self.count),
        ]
        .into_iter()
        .filter_map(move |(owner, field)| (owner == table).then_some(field))
    }
}
impl super::Schema {
    // @ref LLP 3000.022#14.3 — derive once, before private maintains leave the
    // device schema. Iterate to a fixed point for captures and maintained parents.
    pub fn prepare_receipt_dependencies(&mut self) {
        if self.receipts.is_empty() {
            self.receipt_dependencies.clear();
            self.receipt_column_costs.clear();
            return;
        }
        let mut fields = self.receipt_dependencies.clone();
        for (name, table) in &self.tables {
            for family in &self.receipts {
                let owned = fields.entry(name.clone()).or_default();
                owned.extend(family.assigned(name).map(str::to_owned));
                if name == &family.members {
                    owned.extend([family.delivered_field.clone(), family.seen_field.clone()]);
                }
                if name == &family.runs {
                    owned.extend(table.columns.keys().cloned());
                }
            }
        }
        loop {
            let before = fields.clone();
            let depends =
                |table: &str, field: &str| before.get(table).is_some_and(|fs| fs.contains(field));
            for (name, table) in &self.tables {
                for (field, path) in &table.recorded {
                    if depends(&path.table, &path.column) {
                        fields
                            .entry(name.clone())
                            .or_default()
                            .insert(field.clone());
                    }
                }
                if let Some(parent) = &table.through {
                    for (field, source) in &parent.fields {
                        if depends(&parent.parent, source) {
                            fields
                                .entry(name.clone())
                                .or_default()
                                .insert(field.clone());
                        }
                    }
                }
            }
            for m in &self.maintains {
                let dependent = m.dependencies().iter().any(|f| depends(&m.source, f))
                    || m.row_key.as_ref().is_some_and(|k| {
                        depends(&m.source, &k.source_key)
                            || depends(&k.table, &k.member_key)
                            || k.fields().iter().any(|f| depends(&k.table, f))
                    });
                if dependent {
                    if let Some(target) = self.tables.get(&m.target) {
                        // Predicate/contribution changes affect even existence and group ids.
                        fields
                            .entry(m.target.clone())
                            .or_default()
                            .extend(target.columns.keys().cloned());
                    }
                    if let Some(owner) = &m.private {
                        fields
                            .entry(owner.table.clone())
                            .or_default()
                            .insert(owner.column.clone());
                    }
                }
            }
            if before == fields {
                break;
            }
        }
        fields.retain(|_, fields| !fields.is_empty());
        self.receipt_dependencies = fields;
        // @ref LLP 3000.022#14.3 — retain prices, never private predicates or
        // values, when the public projection removes column derivations.
        #[cfg(feature = "sqlite")]
        if (self.maintains.iter().any(|m| m.private.is_some()) || self.tables.values().all(|t| t.maintained.is_empty())) && self.maintains.iter().all(|m|
            m.private.as_ref().is_none_or(|owner| self.tables.contains_key(&m.source)
                && self.tables.contains_key(&m.target) && self.tables.contains_key(&owner.table))) {
            self.receipt_column_costs = self.maintains.iter().filter(|m| m.private.is_some()
                && self.receipt_dependencies.contains_key(&m.target))
                .map(|m| (m.source.clone(), crate::engine::columns::reservation(self, &m.source))).collect();
        }
    }

    pub fn receipt_assigned(&self, table: &str, field: &str) -> bool {
        self.receipts
            .iter()
            .any(|f| f.assigned(table).any(|c| c == field))
    }
    pub fn receipt_insert(&self, table: &str) -> bool {
        self.receipts
            .iter()
            .any(|f| table == f.messages || table == f.members || table == f.scope)
    }
}
