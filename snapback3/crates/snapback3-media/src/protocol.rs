use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
pub struct Refusal {
    pub code: String,
    pub family: String,
    pub message: String,
    pub rewrite: String,
    pub site: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub details: BTreeMap<String, Value>,
}

impl Refusal {
    pub fn new(
        code: impl Into<String>,
        family: impl Into<String>,
        message: impl Into<String>,
        rewrite: impl Into<String>,
        site: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            family: family.into(),
            message: message.into(),
            rewrite: rewrite.into(),
            site: site.into(),
            details: BTreeMap::new(),
        }
    }

    pub fn with_detail(mut self, key: impl Into<String>, value: Value) -> Self {
        self.details.insert(key.into(), value);
        self
    }
}
