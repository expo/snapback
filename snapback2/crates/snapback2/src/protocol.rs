//! Shared wire and CLI refusal shapes.

use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback2_core::{IdentityError, RuntimeError, SuccessorRefusal, Value};
use std::collections::BTreeMap;

pub(crate) fn certification_family_guide(code: &str) -> (&'static str, &'static str) {
    match code {
        code if code.starts_with("E_SCHEDULE") => ("schedule", "schedule"),
        code if code.starts_with("E_JOB") => ("job", "job"),
        "E_UNBOUND_SCAN" => ("bound", "quarry"),
        "E_UNBOUND_LOOP" => ("bound", "bound/loop"),
        // @ref LLP 1017.000#31-d1 — the fan-out refusal's guide page is the
        // which-shape decision, not the loop-bound mechanics.
        "E_STRUCTURAL_FANOUT" => ("bound", "fanout"),
        "E_STRUCTURAL_COUNT" => ("bound", "bound/count"),
        // @ref LLP 1020#a6-the-successor-page-and-its-families — the step ceiling is a
        // bound with its own family pair; `check` files it where the runtime does.
        "E_STEPS" => ("bound", "bounds"),
        "E_AMBIENT_TIME" => ("opaque", "opaque/time"),
        code if code.starts_with("E_BOUND") || code.starts_with("E_UNBOUND") => {
            ("bound", "bound/ceiling")
        }
        code if code.starts_with("E_SCHEMA") => ("schema", "schema/project"),
        code if code.starts_with("E_RULE") => ("rule", "schema/rules"),
        code if code.starts_with("E_SEED") => ("input", "schema/seed"),
        "E_EMIT_IN_QUERY" => ("effect", "effects/authoring"),
        code if code.starts_with("E_EFFECT") => ("effect", "effects/authoring"),
        "E_DECIMAL_SCALE" => ("args", "programs/types"),
        code if code.starts_with("E_ARGS") => ("args", "programs/types"),
        code if code.starts_with("E_OP") => ("op", "programs/operations"),
        _ => ("opaque", "opaque/subset"),
    }
}

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
        let code = code.into();
        let message = message.into();
        let message = refusal_message(&code, &message).to_owned();
        Self {
            code,
            family: family.into(),
            message,
            site: None,
            rule: None,
            rewrite: Some(rewrite.into()),
            guide: guide.into(),
            detail: BTreeMap::new(),
        }
    }

    // @ref LLP 1002#diagnostics-say-the-fix — use the same declared catalog on CLI and owner paths.
    pub fn unknown_operation<'a>(op: &str, names: impl IntoIterator<Item = &'a str>) -> Self {
        let mut names: Vec<_> = names.into_iter().collect();
        names.sort_unstable();
        names.dedup();
        let nearest = names.iter().filter_map(|name| {
            let candidate = if op.contains('.') { name } else { name.rsplit('.').next().unwrap_or(name) };
            let same_case = candidate.eq_ignore_ascii_case(op);
            let distance = spelling_distance(op, candidate);
            (same_case || distance <= 2).then_some((!same_case, distance, *name))
        }).min();
        let rewrite = match nearest {
            Some((_, _, name)) => format!("did you mean `{name}`? use a qualified name from /api/manifest"),
            None => format!("declared operations: {}; use a qualified name from /api/manifest", if names.is_empty() { "none".to_owned() } else { names.join(", ") }),
        };
        Self::new("E_OP_UNKNOWN", "op", format!("unknown or ambiguous operation {op}"), rewrite, "quarry").with_site(op)
    }

    pub fn owner(code: &str, message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        Self::new(code, "owner", message, rewrite, "owner/dev")
    }

    pub fn input(message: impl Into<String>, rewrite: impl Into<String>) -> Self {
        Self::new("E_INPUT", "input", message, rewrite, "input/json")
    }

    /// The runtime `offline` family (LLP 1012 §15): every code carries its
    /// site and rewrite here, and `snapback2 guide offline` is their page.
    // @ref LLP 1012#15-diagnostics — a conflict is a mutation state, never one of these codes.
    pub fn offline(code: &str, message: impl Into<String>) -> Self {
        let (site, rewrite) = offline_site_and_rewrite(code);
        Self::new(code, "offline", message, rewrite, "offline").with_site(site)
    }

    pub fn with_site(mut self, site: impl Into<String>) -> Self {
        self.site = Some(site.into());
        self
    }

    pub fn with_detail(mut self, name: impl Into<String>, value: Json) -> Self {
        self.detail.insert(name.into(), value);
        self
    }

    pub fn from_refusals(errors: Vec<Self>, fallback: Self) -> Self {
        let Some(mut refusal) = errors.first().cloned() else {
            return fallback;
        };
        if errors.len() > 1 {
            refusal.detail.insert(
                "refusals".to_owned(),
                serde_json::to_value(errors).unwrap_or_else(|_| Json::Array(Vec::new())),
            );
        }
        refusal
    }

    pub fn from_runtime(error: &RuntimeError) -> Self {
        if let RuntimeError::Require { code, site } = error {
            let mut refusal = Self::new(code, "rule", error.to_string(),
                "satisfy the program requirement before retrying", "rule/runtime");
            refusal.rule = Some(code.clone());
            refusal.site = site.clone();
            return refusal;
        }
        if let RuntimeError::Successor(refusal) = error {
            return Self::from_successor(refusal);
        }
        if let RuntimeError::SchemaConstraint { message, rewrite } = error {
            return Self::new(
                "E_SCHEMA_CONSTRAINT",
                "schema",
                message,
                rewrite,
                "schema/project",
            );
        }
        if let RuntimeError::Job(error) = error {
            let mut refusal = Self::new(
                &error.code,
                &error.family,
                &error.message,
                &error.rewrite,
                &error.guide,
            )
            .with_site(&error.site);
            if let Some(job) = &error.job {
                refusal = refusal.with_detail("job", json!(job));
            }
            if let Some(sweep) = error.sweep {
                refusal = refusal.with_detail("sweep", json!(sweep));
            }
            if let Some(chunk) = error.chunk {
                refusal = refusal.with_detail("chunk", json!(chunk));
            }
            return refusal;
        }
        if let RuntimeError::AssetTooLarge(message) = error {
            return Self::new(
                "E_ASSET_TOO_LARGE",
                "input",
                message,
                "use bytes within the column bound; for a pending-object or byte admission ceiling, inspect client.listUploads() and discard only abandoned ids with client.discardUpload(id), or wait for eligible cleanup",
                "operator",
            );
        }
        if let RuntimeError::AssetViewed(id) = error {
            return Self::new(
                "E_ASSET_VIEWED",
                "assets",
                format!("asset {id} was already delivered to this principal"),
                "render this image once; request a new image for another delivery",
                "quarry",
            )
            .with_site(format!("/api/asset/{id}"));
        }
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
            // @ref LLP 1001#6-identity-identityrs — legacy plaintext-session stores are refused,
            // so the local recovery needs to name the exact disposable dev-store artifact.
            "E_STORE_VERSION" => {
                "stop snapback2 dev, delete .snapback/store.sqlite, and restart the owner"
            }
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
            IdentityError::ReservedSystem => "E_AUTH_RESERVED",
            IdentityError::EmailTaken => "E_AUTH_EMAIL_TAKEN",
            IdentityError::PasswordWeak => "E_AUTH_PASSWORD_WEAK",
            IdentityError::Invalid => "E_AUTH_INVALID",
            IdentityError::GuestsOff => "E_AUTH_GUESTS_OFF",
            IdentityError::Session => "E_AUTH_SESSION",
            IdentityError::Store(_) => "E_AUTH_STORE",
            IdentityError::Crypto(_) => "E_AUTH_CRYPTO",
        };
        let rewrite = match error {
            IdentityError::ReservedSystem => {
                "use --as system on run, data, or why against the local dev owner"
            }
            IdentityError::PasswordWeak => "use a password containing at least 8 characters",
            IdentityError::GuestsOff => "sign up or enable guests in the project's snapback/schema",
            IdentityError::Session => "log in again and send Authorization: Bearer <token>",
            _ => "correct the authentication request and retry",
        };
        Self::new(code, "auth", error.to_string(), rewrite, "auth/identity")
    }

    pub fn operator_required() -> Self {
        Self::new(
            "E_OPERATOR_REQUIRED",
            "operator",
            "the operator seat requires a local dev control route",
            "run it locally against `dev`, or with an `admin` token once `serve`-mode tokens exist",
            "operator/seat",
        )
        .with_site("--as system")
    }

    /// A schedule target reached through `/api/*`: the same seat refusal a job gets, on the
    /// schedule page, naming the schedule that owns the program.
    pub fn schedule_target(op: &str, schedule: &str) -> Self {
        Self::new(
            "E_OPERATOR_REQUIRED",
            "operator",
            format!("{op} is the target of schedule {schedule}: the owner runs it when the timer fires"),
            format!(
                "let the schedule fire it, or `run {op} --as system`; a client-callable version is a second program"
            ),
            "schedule",
        )
        .with_site(format!("schedule {schedule}"))
    }

    pub fn from_successor(error: &SuccessorRefusal) -> Self {
        let mut refusal = Self::new(
            &error.code,
            "successor",
            &error.message,
            &error.rewrite,
            "successor",
        )
        .with_detail("from", json!(error.from))
        .with_detail("to", json!(error.to))
        .with_detail(
            "plan",
            serde_json::to_value(&error.plan).unwrap_or(Json::Null),
        )
        .with_detail(
            "conflicts",
            serde_json::to_value(&error.conflicts).unwrap_or(Json::Array(Vec::new())),
        )
        .with_detail(
            "capConflicts",
            serde_json::to_value(&error.cap_conflicts).unwrap_or(Json::Array(Vec::new())),
        );
        if let Some(site) = &error.site {
            refusal = refusal.with_site(site);
        }
        if let Some(narrowing) = error.narrowings.iter().find(|c| c.affected_rows > 0) {
            refusal = refusal
                .with_detail("table", json!(narrowing.table))
                .with_detail("column", json!(narrowing.column))
                .with_detail("nullRows", json!(narrowing.null_rows))
                .with_detail("oversizeRows", json!(narrowing.oversize_rows))
                .with_detail("affectedRows", json!(narrowing.affected_rows))
                .with_detail("removedCases", json!(narrowing.removed_cases))
                .with_detail("sample", json!(narrowing.sample))
                .with_detail("narrowings", json!(error.narrowings));
        }
        refusal
    }
}

// The engine's Display text is also used in logs; envelopes carry its code separately.
pub(crate) fn refusal_message<'a>(code: &str, message: &'a str) -> &'a str {
    message
        .strip_prefix(&format!("E_REQUIRE:{code}:"))
        .or_else(|| message.strip_prefix(&format!("{code}:")))
        .map(str::trim_start)
        .unwrap_or(message)
}

// Unrestricted Damerau–Levenshtein: adjacent transpositions cost one edit.
fn spelling_distance(left: &str, right: &str) -> usize {
    let a: Vec<_> = left.chars().collect();
    let b: Vec<_> = right.chars().collect();
    if a.len().abs_diff(b.len()) > 2 { return 3; }
    let max = a.len() + b.len();
    let mut d = vec![vec![0; b.len() + 2]; a.len() + 2];
    d[0][0] = max;
    for i in 0..=a.len() { d[i + 1][0] = max; d[i + 1][1] = i; }
    for j in 0..=b.len() { d[0][j + 1] = max; d[1][j + 1] = j; }
    let mut last = BTreeMap::new();
    for i in 1..=a.len() {
        let mut matched = 0;
        for j in 1..=b.len() {
            let row = *last.get(&b[j - 1]).unwrap_or(&0);
            let col = matched;
            let cost = usize::from(a[i - 1] != b[j - 1]);
            if cost == 0 { matched = j; }
            d[i + 1][j + 1] = (d[i][j] + cost).min(d[i + 1][j] + 1).min(d[i][j + 1] + 1)
                .min(d[row][col] + (i - row - 1) + 1 + (j - col - 1));
        }
        last.insert(a[i - 1], i);
    }
    d[a.len() + 1][b.len() + 1]
}

#[cfg(test)]
const OFFLINE_CODES: [&str; 6] = [
    "E_OFFLINE_RESET",
    "E_OFFLINE_RESUME",
    "E_OFFLINE_INTENT_EXPIRED",
    "E_OFFLINE_INTENT_REUSE",
    "E_OFFLINE_ID_BLOCK",
    "E_OFFLINE_AUTHORITY",
];

fn offline_site_and_rewrite(code: &str) -> (&'static str, &'static str) {
    match code {
        "E_OFFLINE_RESET" => (
            "/api/resume.generation",
            "drop held coverage, keep the sealed outbox, fetch /api/program for the returned generation, and cold-drain",
        ),
        "E_OFFLINE_RESUME" => (
            "/api/resume.mounted",
            "re-subscribe the rest as ordinary reads",
        ),
        "E_OFFLINE_INTENT_EXPIRED" => (
            "/api/mutation.replay.grant",
            "resume as the grant's principal for a fresh grant, then enqueue a new intent",
        ),
        "E_OFFLINE_INTENT_REUSE" => (
            "/api/mutation.replay.intent",
            "retry an intent only with its original op, args, id slice, and trace; use a new slice for new bytes",
        ),
        "E_OFFLINE_ID_BLOCK" => (
            "/api/mutation.replay.offset",
            "consume an unused contiguous slice inside the grant and name the intent <grant>:<offset>",
        ),
        // @ref LLP 1012#15-diagnostics — a local authority violation is never a
        // reset: the client keeps its held coverage and refuses the delivery.
        "E_OFFLINE_AUTHORITY" => (
            "/api/query.authority.principal",
            "keep the held coverage; a delivery for another principal or auth epoch is refused, not committed — open the partition it belongs to (another generation is not refused: it supersedes the held coverage until the next resume resets it)",
        ),
        _ => panic!("{code} is not an offline diagnostic"),
    }
}

pub fn value_to_json(value: &Value) -> Json {
    snapback2_core::value_to_wire_json(value)
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
            .map(|fields| Value::Map(fields.into())),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authored_require_uses_the_first_class_rule_field() {
        let refusal = Refusal::from_runtime(&RuntimeError::Require { code: "conflict".into(), site: Some("snapback/rules.q:8:3".into()) });
        assert_eq!(refusal.rule.as_deref(), Some("conflict"));
        assert!(!refusal.detail.contains_key("rule"));
        let wire = serde_json::to_value(&refusal).unwrap();
        assert_eq!(wire["rule"], "conflict");
        assert_eq!(wire["site"], "snapback/rules.q:8:3");
    }

    #[test]
    fn operator_argument_name_has_a_registered_site_rewrite_and_guide_page() {
        let families: Json = serde_json::from_str(include_str!(
            "../../../packages/snapback2/guide/families.source.json"
        ))
        .unwrap();
        let record = families
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["code"] == "E_ARGS_NAME")
            .unwrap();
        assert_eq!(record["family"], "args");
        assert_eq!(record["site"], "by");
        assert_eq!(record["guide"], "operator");
        assert!(record["right"].as_str().unwrap().contains("1–80 ASCII"));
        assert!(
            include_str!("../../../packages/snapback2/guide/operator.md").contains("E_ARGS_NAME")
        );
    }

    #[test]
    fn every_offline_code_has_a_family_a_site_a_rewrite_and_the_guide_page() {
        for code in OFFLINE_CODES {
            let refusal = Refusal::offline(code, "why");
            assert_eq!(refusal.code, code);
            assert_eq!(refusal.family, "offline");
            assert_eq!(refusal.guide, "offline");
            assert!(
                refusal
                    .site
                    .as_deref()
                    .is_some_and(|site| site.starts_with("/api/"))
            );
            assert!(
                refusal
                    .rewrite
                    .as_deref()
                    .is_some_and(|rewrite| !rewrite.is_empty())
            );
        }
        let families: Json = serde_json::from_str(include_str!(
            "../../../packages/snapback2/guide/families.source.json"
        ))
        .unwrap();
        for code in OFFLINE_CODES {
            assert!(
                families
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| { entry["code"] == code && entry["family"] == "offline" }),
                "{code} is missing from guide/families.source.json"
            );
        }
    }

    #[test]
    fn stale_store_version_names_the_recoverable_dev_reset() {
        let refusal = Refusal::from_runtime(&RuntimeError::StoreVersion {
            detail: "legacy sessions table".to_owned(),
        });
        assert_eq!(refusal.code, "E_STORE_VERSION");
        assert_eq!(refusal.family, "owner");
        assert_eq!(
            refusal.rewrite.as_deref(),
            Some("stop snapback2 dev, delete .snapback/store.sqlite, and restart the owner")
        );
    }
}

#[cfg(test)]
#[test]
fn runtime_input_message_does_not_repeat_its_code() {
    let refusal = Refusal::from_runtime(&RuntimeError::Input(
        "cursor belongs to another index".to_owned(),
    ));
    assert_eq!(refusal.code, "E_INPUT");
    assert_eq!(refusal.message, "cursor belongs to another index");
}

#[cfg(test)]
#[test]
fn runtime_requirement_message_does_not_embed_its_application_code() {
    let refusal = Refusal::from_runtime(&RuntimeError::Require {
        code: "MEMBERSHIP_REQUIRED".to_owned(),
        site: None,
    });
    assert_eq!(refusal.code, "MEMBERSHIP_REQUIRED");
    assert_eq!(refusal.message, "program requirement failed");
}

pub(crate) fn successor_site(mut refusal: Refusal, next: &crate::project::CompiledProject, previous: Option<&crate::project::CompiledProject>) -> Refusal {
    if let Some(site) = &refusal.site {
        let table = site.split(".columns.").next().unwrap_or(site).split(".indexes.").next().unwrap_or(site);
        if let Some(source) = next.sources.get(site)
            .or_else(|| previous.and_then(|p| p.sources.get(site)))
            .or_else(|| next.sources.get(table))
            .or_else(|| previous.and_then(|p| p.sources.get(table))) {
            refusal.site = Some(format!("{}:{}:{}", source.file, source.line, source.col));
        } else if let Some((table, column)) = site.strip_prefix("schema.tables.").and_then(|s| s.split_once(".columns.")) {
            // Direct IR applications have no authored source map.
            refusal.site = Some(format!("{table}.{column}"));
        }
    }
    refusal
}

