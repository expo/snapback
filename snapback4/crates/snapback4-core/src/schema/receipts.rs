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
