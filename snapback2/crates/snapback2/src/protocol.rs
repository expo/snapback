//! Shared wire and CLI refusal shapes.

use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback2_core::{IdentityError, RuntimeError, SuccessorRefusal, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub code: String,
    pub family: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewrite: Option<String>,
    pub guide: String,
    #[serde(flatten)]
    pub detail: BTreeMap<String, Json>,
}

impl Refusal {
    pub fn new(
        code: impl Into<String>,
        family: impl Into<String>,
        message: impl Into<String>,
        rewrite: impl Into<String>,
        guide: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            family: family.into(),
            message: message.into(),
            site: None,
            rule: None,
            rewrite: Some(rewrite.into()),
            guide: guide.into(),
            detail: BTreeMap::new(),
        }
    }

    pub fn owner(code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        Self::new(code, "owner", message, rewrite, "owner/dev")
    }

    pub fn input(message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        Self::new("E_INPUT", "input", message, rewrite, "input/json")
    }

    pub fn with_site(mut self, site: impl Into<String>) -> Self {
        self.site = Some(site.into());
        self
    }

    pub fn with_detail(mut self, name: impl Into<String>, value: Json) -> Self {
        self.detail.insert(name.into(), value);
        self
    }

    pub fn from_runtime(error: &RuntimeError) -> Self {
        let code = error.code();
        let family = if code.starts_with("E_AUTH") {
            "auth"
        } else if code.starts_with("E_SUCCESSOR") || code.starts_with("E_MIGRATION") {
            "successor"
        } else if code.starts_with("E_SCHEMA") {
            "schema"
        } else if code.starts_with("E_OP") {
            "op"
        } else if code.starts_with("E_RULE") {
            "rule"
        } else if code.starts_with("E_BOUND")
            || matches!(code, "E_FANOUT" | "E_STEPS" | "E_TRACE_SUBSET")
        {
            "bound"
        } else if code.starts_with("E_STORE") {
            "owner"
        } else {
            "input"
        };
        let rewrite = match code {
            "E_OP_UNKNOWN" => "use an operation listed by /api/manifest",
            "E_STORE_OWNED" => "attach to the existing owner or stop it before starting another",
            "E_RULE" => "use a principal admitted by the table rule",
            "E_INPUT" => "pass arguments matching the operation declaration",
            _ => "fix the refused input and retry",
        };
        Self::new(
            code,
            family,
            error.to_string(),
            rewrite,
            format!("{family}/runtime"),
        )
    }

    pub fn from_identity(error: &IdentityError) -> Self {
        let code = match error {
            IdentityError::EmailTaken => "E_AUTH_EMAIL_TAKEN",
            IdentityError::PasswordWeak => "E_AUTH_PASSWORD_WEAK",
            IdentityError::Invalid => "E_AUTH_INVALID",
            IdentityError::GuestsOff => "E_AUTH_GUESTS_OFF",
            IdentityError::Session => "E_AUTH_SESSION",
            IdentityError::Store(_) => "E_AUTH_STORE",
            IdentityError::Crypto(_) => "E_AUTH_CRYPTO",
        };
        let rewrite = match error {
            IdentityError::PasswordWeak => "use a password containing at least 8 characters",
            IdentityError::GuestsOff => "sign up or enable guests in snapback/schema.ts",
            IdentityError::Session => "log in again and send Authorization: Bearer <token>",
            _ => "correct the authentication request and retry",
        };
        Self::new(code, "auth", error.to_string(), rewrite, "auth/identity")
    }

    pub fn from_successor(error: &SuccessorRefusal) -> Self {
        Self::new(
            &error.code,
            "successor",
            &error.message,
            &error.rewrite,
            "successor/migrations",
        )
        .with_detail(
            "plan",
            serde_json::to_value(&error.plan).unwrap_or(Json::Null),
        )
        .with_detail(
            "conflicts",
            serde_json::to_value(&error.conflicts).unwrap_or(Json::Array(Vec::new())),
        )
    }
}

pub fn value_to_json(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(value) => Json::Bool(*value),
        Value::Int(value) => Json::Number((*value).into()),
        Value::String(value) | Value::Id(value) => Json::String(value.clone()),
        Value::Row(values) | Value::Map(values) => Json::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), value_to_json(value)))
                .collect(),
        ),
        Value::Array(values) => Json::Array(values.iter().map(value_to_json).collect()),
    }
}

pub fn json_to_value(value: &Json) -> Result<Value, Refusal> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Bool(value) => Ok(Value::Bool(*value)),
        Json::Number(value) => value.as_i64().map(Value::Int).ok_or_else(|| {
            Refusal::input(
                "numbers must be signed i53 integers",
                "send an integer within JavaScript's safe range",
            )
        }),
        Json::String(value) => Ok(Value::String(value.clone())),
        Json::Array(values) => values
            .iter()
            .map(json_to_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Json::Object(values) => values
            .iter()
            .map(|(key, value)| Ok((key.clone(), json_to_value(value)?)))
            .collect::<Result<BTreeMap<_, _>, Refusal>>()
            .map(Value::Map),
    }
}

pub fn refusal_json(refusal: &Refusal) -> Json {
    serde_json::to_value(refusal).unwrap_or_else(|_| {
        json!({
            "code": "E_SERIALIZATION",
            "family": "owner",
            "message": "the refusal envelope could not be serialized",
            "rewrite": "restart snapback2 dev and inspect .snapback/log.jsonl",
            "guide": "owner/protocol",
        })
    })
}
