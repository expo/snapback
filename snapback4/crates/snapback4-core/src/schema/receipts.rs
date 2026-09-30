use serde::{Deserialize, Serialize};
// @ref LLP 3000.022#14 — names and mappings are explicit; v2 owns metered compaction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReceiptFamily {
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
                const NAMES: [&str; 11] = [
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
                let mut fields: [String; 11] = Default::default();
                let mut seen = 0_u16;
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
                if seen != 2047 {
                    return Err(serde::de::Error::custom("incomplete receipt mappings"));
                }
                let [
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
