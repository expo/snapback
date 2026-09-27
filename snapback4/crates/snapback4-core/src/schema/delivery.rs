use serde::{Deserialize, Serialize};

// @ref LLP 3000.019#4 — P7 keeps the card's model and moves its reporter into the SDK.
// @ref LLP 3000.022#2.1 — the compiled binding travels with the existing backend schema.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct DeliveryBinding {
    pub table: String,
    pub group: String,
    pub position: String,
    pub mutation: String,
    pub args: Vec<String>,
    pub fingerprint: String,
}

// This streaming map reader shares the ordinary String/Vec readers with the
// backend schema. A generated field-name decoder adds another wasm family.
impl<'de> Deserialize<'de> for DeliveryBinding {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Binding;
        impl<'de> serde::de::Visitor<'de> for Binding {
            type Value = DeliveryBinding;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a delivery binding with three argument names")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut fields: [String; 5] = Default::default();
                let mut args = Vec::new();
                let mut seen = 0_u8;
                const NAMES: [&str; 6] = ["table", "group", "position", "mutation", "fingerprint", "args"];
                while let Some(key) = map.next_key::<String>()? {
                    let Some(index) = NAMES.iter().position(|name| *name == key) else {
                        let _ = map.next_value::<serde::de::IgnoredAny>()?;
                        continue;
                    };
                    let bit = 1 << index;
                    if seen & bit != 0 { return Err(serde::de::Error::custom("duplicate delivery field")); }
                    seen |= bit;
                    if index == 5 { args = map.next_value()?; }
                    else { fields[index] = map.next_value()?; }
                }
                if seen != 63 || args.len() != 3 {
                    return Err(serde::de::Error::custom("delivery needs table, group, position, mutation, fingerprint and three arguments"));
                }
                let [table, group, position, mutation, fingerprint] = fields;
                Ok(DeliveryBinding { table, group, position, mutation, args, fingerprint })
            }
        }
        deserializer.deserialize_map(Binding)
    }
}

