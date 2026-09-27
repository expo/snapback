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
                let mut out = DeliveryBinding::default();
                let mut seen = 0_u8;
                while let Some(key) = map.next_key::<String>()? {
                    let bit = match key.as_str() {
                        "table" => 1,
                        "group" => 2,
                        "position" => 4,
                        "mutation" => 8,
                        "args" => 16,
                        _ => 0,
                    };
                    if seen & bit != 0 {
                        return Err(serde::de::Error::custom("duplicate delivery field"));
                    }
                    seen |= bit;
                    match bit {
                        1 => out.table = map.next_value()?,
                        2 => out.group = map.next_value()?,
                        4 => out.position = map.next_value()?,
                        8 => out.mutation = map.next_value()?,
                        16 => out.args = map.next_value()?,
                        _ => {
                            let _ = map.next_value::<serde::de::IgnoredAny>()?;
                        }
                    }
                }
                if seen != 31 || out.args.len() != 3 {
                    return Err(serde::de::Error::custom(
                        "delivery needs table, group, position, mutation and three arguments",
                    ));
                }
                Ok(out)
            }
        }
        deserializer.deserialize_map(Binding)
    }
}
