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

impl DeliveryBinding {
    /// SHA-256 over the domain and seven UTF-8 strings with u64 BE byte lengths.
    // @ref LLP 3000.022#5 — the digest fences a report at its execution boundary.
    pub fn compute_fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        hash.update(b"snapback4.delivery.v1\0");
        for field in [&self.table, &self.group, &self.position, &self.mutation].into_iter().chain(self.args.iter()) {
            hash.update((field.len() as u64).to_be_bytes());
            hash.update(field.as_bytes());
        }
        format!("{:x}", hash.finalize())
    }
}

#[cfg(feature = "sqlite")]
impl super::Schema {
    pub fn check_delivery(&self, mutation: &str, fingerprint: Option<&str>) -> Result<(), crate::RuntimeError> {
        if let Some(fingerprint) = fingerprint {
            if !self.delivery.iter().any(|binding| binding.mutation == mutation && binding.fingerprint == fingerprint) {
                return Err(crate::RuntimeError::Structural {
                    code: "E_DELIVERY_BINDING",
                    message: format!("{mutation}'s delivery binding changed or was removed; drop this binding's debt and collect under the current binding"),
                });
            }
        }
        Ok(())
    }
}
