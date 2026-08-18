//! App config & secrets store — the LLP 0036 v1 `local-file-immediate`
//! backend.
//!
//! @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — deployment-owned
//! values live in a 0600 sibling file of the SQLite database, never inside it,
//! and survive `app.reset`; the file backend is single-instance by contract
//! (the database instance lock is the enforcement seam).
//! @ref LLP 0009#secrets — no read-back: this module exposes value material
//! only to the runtime grant path; every other consumer sees names and status.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::telemetry::TelemetryConfig;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization as _;

pub const CONFIG_STORE_FORMAT_VERSION: u32 = 1;

/// Minimum interval between probe runs for one entry.
///
/// @ref LLP 0036#operations-and-projections-llp-0024 — probe rules: a probe is
/// a quota-burn tool pointed at a vendor, so verify is cooldown-limited. The
/// hard wall-clock timeout the RFC also wants now covers probes too: the
/// server's verify route stages the probe under the lock, runs it detached
/// under the ENG-23324 action watchdog, and records the outcome in a second
/// short lock window (ENG-23493; `action_wall_clock_timeout` reports
/// `Enforced`). Queries/mutations still have no timeout
/// (`wall_clock_timeout` reports `Missing`).
pub const VERIFY_COOLDOWN_MS: u64 = 5_000;

/// The result a probe verification leaves behind. Never carries a value.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct VerificationRecord {
    pub ok: bool,
    #[serde(rename = "atMs", alias = "at_ms")]
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

/// Invocation-time snapshot of every configured secret value. Detached
/// actions carry this across the lock boundary so a value rotated or unset
/// while handler code is running can still be removed from its eventual error
/// envelope and retention sinks.
#[derive(Clone, Debug, Default)]
pub(crate) struct SecretRedactor {
    patterns: Vec<Regex>,
}

impl SecretRedactor {
    fn new(mut secrets: Vec<String>) -> Self {
        secrets.retain(|secret| !secret.is_empty());
        // Replace overlapping values longest-first so no recognizable suffix
        // survives a shorter prefix replacement.
        secrets.sort_unstable_by(|left, right| {
            right.len().cmp(&left.len()).then_with(|| left.cmp(right))
        });
        secrets.dedup();
        let patterns = secrets
            .iter()
            .flat_map(|secret| secret_redaction_patterns(secret))
            .collect();
        Self { patterns }
    }

    /// Construct the invocation-lifetime redactor for a request-scoped secret
    /// that is deliberately outside the persisted LLP 0036 store.
    ///
    /// @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — caller model
    /// keys are never persisted or logged, but receive the same reversible-
    /// representation scrubbing as stored secrets while the request exists.
    pub(crate) fn request_scoped(secret: String) -> Self {
        Self::new(vec![secret])
    }

    pub(crate) fn redact_text(&self, text: &str) -> String {
        let mut redacted = text.to_owned();
        for pattern in &self.patterns {
            redacted = pattern.replace_all(&redacted, "[REDACTED]").into_owned();
        }
        redacted
    }

    /// Scrub every string leaf in a structured diagnostics value while
    /// preserving its shape for telemetry and host-call trace consumers.
    pub(crate) fn redact_value(&self, mut value: serde_json::Value) -> serde_json::Value {
        redact_value_strings(self, &mut value);
        value
    }

    pub(crate) fn redact_diagnostic(
        &self,
        mut diagnostic: crate::diagnostic::Diagnostic,
    ) -> crate::diagnostic::Diagnostic {
        diagnostic.message = self.redact_text(&diagnostic.message);
        redact_value_strings(self, &mut diagnostic.details);
        diagnostic
    }

    pub(crate) fn redact_error(&self, mut error: SnapbackError) -> SnapbackError {
        error.diagnostic = self.redact_diagnostic(error.diagnostic);
        let mut private_redaction_witnessed = false;
        if let Some(context) = error.private_failure_context_mut() {
            for carrier in &mut context.carriers {
                if let Some(message) = carrier.message.as_mut() {
                    let redacted = self.redact_text(message);
                    private_redaction_witnessed |= redacted != *message;
                    *message = redacted;
                }
                if let Some(stack) = carrier.stack.as_mut() {
                    let redacted = self.redact_text(stack);
                    private_redaction_witnessed |= redacted != *stack;
                    *stack = redacted;
                }
            }
        }
        // @ref LLP 0036#runtime-exposure-d5-d8 — production handler errors
        // remain generic, but if the invocation-lifetime redactor scrubbed the
        // private carrier the public envelope retains a literal, value-free
        // witness instead of making the required redaction unobservable.
        if private_redaction_witnessed
            && error.diagnostic.code == "SNAPBACK_HANDLER_FAILED"
            && let Some(details) = error.diagnostic.details.as_object_mut()
        {
            details
                .entry("message".to_owned())
                .or_insert_with(|| serde_json::json!("[REDACTED]"));
        }
        error
    }
}

/// Compile the same reversible representation language enforced by the
/// Cloudflare host-fetch boundary. Each pattern consumes one complete secret;
/// it never falls back to prefix matching.
///
/// @ref LLP 0036#runtime-exposure-d5-d8 — public and retained diagnostics
/// scrub raw, normalized, JSON-escaped, and URL/form-encoded secret forms.
fn secret_redaction_patterns(secret: &str) -> Vec<Regex> {
    let normalized = BTreeSet::from([
        secret.to_owned(),
        secret.nfc().collect::<String>(),
        secret.nfd().collect::<String>(),
    ]);

    let mut encoded = normalized.clone();
    for _ in 0..2 {
        for candidate in encoded.clone() {
            encoded.insert(percent_encode(&candidate, false));
            encoded.insert(percent_encode(&candidate, true));
        }
    }

    let mut literal_patterns = encoded
        .difference(&normalized)
        .filter(|candidate| !candidate.is_empty())
        .map(|candidate| candidate.to_owned())
        .collect::<Vec<_>>();
    literal_patterns.sort_unstable_by_key(|candidate| std::cmp::Reverse(candidate.len()));

    let mut patterns = literal_patterns
        .into_iter()
        .map(|candidate| compile_redaction_pattern(&format!("(?i:{})", regex::escape(&candidate))))
        .collect::<Vec<_>>();
    patterns.extend(
        normalized
            .iter()
            .filter(|candidate| !candidate.is_empty())
            .map(|candidate| compile_redaction_pattern(&json_escape_language(candidate))),
    );
    patterns
}

fn compile_redaction_pattern(pattern: &str) -> Regex {
    Regex::new(pattern).expect("secret redaction patterns are constructed from escaped input")
}

fn json_escape_language(candidate: &str) -> String {
    let mut pattern = String::new();
    for character in candidate.chars() {
        let raw = regex::escape(&character.to_string());
        let mut alternatives = vec![raw];
        let mut units = [0_u16; 2];
        let encoded = character.encode_utf16(&mut units);
        let unicode = encoded
            .iter()
            .map(|unit| format!(r"\\+[uU](?i:{unit:04x})"))
            .collect::<String>();
        alternatives.push(unicode);
        if let Some(short) = json_short_escape(character) {
            alternatives.push(format!(r"\\+(?i:{})", regex::escape(short)));
        }
        pattern.push_str("(?:");
        pattern.push_str(&alternatives.join("|"));
        pattern.push(')');
    }
    pattern
}

fn json_short_escape(character: char) -> Option<&'static str> {
    match character {
        '\u{0008}' => Some("b"),
        '\t' => Some("t"),
        '\n' => Some("n"),
        '\u{000c}' => Some("f"),
        '\r' => Some("r"),
        '"' => Some("\""),
        '/' => Some("/"),
        '\\' => Some("\\"),
        _ => None,
    }
}

fn percent_encode(value: &str, form: bool) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        let allowed = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'.' | b'_')
            || (!form && matches!(byte, b'!' | b'~' | b'*' | b'\'' | b'(' | b')'));
        if allowed {
            encoded.push(char::from(byte));
        } else if form && byte == b' ' {
            encoded.push('+');
        } else {
            const HEX: &[u8; 16] = b"0123456789ABCDEF";
            encoded.push('%');
            encoded.push(char::from(HEX[(byte >> 4) as usize]));
            encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }
    encoded
}

/// One stored entry: an ordered member pool (a single-valued entry is a
/// one-member pool) plus names-and-status metadata. Values leave this struct
/// only through [`ConfigStore::values`].
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct StoredEntry {
    values: Vec<String>,
    /// Opaque value identity. It changes on every set (including a same-value
    /// rewrite), so a detached verifier can compare-and-set its result without
    /// retaining or hashing secret material.
    #[serde(default)]
    pub revision: u64,
    #[serde(rename = "setAtMs", alias = "set_at_ms")]
    pub set_at_ms: u64,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified: Option<VerificationRecord>,
}

impl StoredEntry {
    pub fn member_count(&self) -> usize {
        self.values.len()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct ConfigFileState {
    version: u32,
    generation: u64,
    entries: BTreeMap<String, StoredEntry>,
    #[serde(default, skip_serializing_if = "telemetry_config_is_default")]
    telemetry: TelemetryConfig,
}

#[derive(Deserialize)]
struct ConfigFileHeader {
    version: u32,
}

impl Default for ConfigFileState {
    fn default() -> Self {
        Self {
            version: CONFIG_STORE_FORMAT_VERSION,
            generation: 0,
            entries: BTreeMap::new(),
            telemetry: TelemetryConfig::default(),
        }
    }
}

fn telemetry_config_is_default(config: &TelemetryConfig) -> bool {
    config == &TelemetryConfig::default()
}

/// Outcome facts of a write, for envelopes and the audit line — never values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriteOutcome {
    pub value_changed: bool,
    pub generation: u64,
}

/// The v1 `local-file-immediate` store. `path: None` is the in-memory flavor
/// used with `:memory:` databases and tests; identical semantics, no
/// persistence.
#[derive(Debug, Default)]
pub struct ConfigStore {
    path: Option<PathBuf>,
    state: ConfigFileState,
    /// Per-entry round-robin cursors for pool rotation. In-memory on purpose:
    /// rotation fairness does not warrant a file write per action invocation.
    rotation: BTreeMap<String, u64>,
    /// Per-entry last verify attempt, for the cooldown. In-memory on purpose:
    /// the cooldown protects vendors from *this* process's loops.
    verify_attempts: BTreeMap<String, u64>,
}

impl ConfigStore {
    pub fn in_memory() -> Self {
        Self::default()
    }

    /// The store file for a given database path: a mechanical sibling
    /// (`dev.sqlite3` → `dev.sqlite3.config.json`) so two databases in one
    /// directory can never share a store by accident.
    pub fn path_for_database(db_path: &Path) -> PathBuf {
        let mut name = db_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "snapback".to_owned());
        name.push_str(".config.json");
        db_path.with_file_name(name)
    }

    /// Load the store beside a database file, creating nothing until the first
    /// write. A malformed store file is a loud error, never a silent wipe.
    pub fn open_for_database(db_path: &Path) -> SnapbackResult<Self> {
        Self::open(Self::path_for_database(db_path))
    }

    pub fn open(path: PathBuf) -> SnapbackResult<Self> {
        let state = match crate::secure_file::read_owner_only(&path) {
            Ok(bytes) => {
                let invalid_store = |error: serde_json::Error| {
                    SnapbackError::error(
                        "SNAPBACK_CONFIG_STORE_INVALID",
                        "config",
                        format!(
                            "config store {} exists but could not be parsed; refusing to overwrite it",
                            path.display()
                        ),
                    )
                    .with_details(serde_json::json!({ "error": error.to_string() }))
                };
                // Read only the version header first. A future format may no
                // longer deserialize into today's entry shape; it must still
                // receive the stable unsupported-version diagnostic and keep
                // its bytes untouched rather than being mistaken for damage.
                let header =
                    serde_json::from_slice::<ConfigFileHeader>(&bytes).map_err(&invalid_store)?;
                if header.version != CONFIG_STORE_FORMAT_VERSION {
                    return Err(SnapbackError::error(
                        "SNAPBACK_CONFIG_STORE_VERSION_UNSUPPORTED",
                        "config",
                        format!(
                            "config store {} uses format version {}, but this binary supports only version {}; refusing to expose or overwrite it",
                            path.display(),
                            header.version,
                            CONFIG_STORE_FORMAT_VERSION
                        ),
                    )
                    .with_details(serde_json::json!({
                        "path": path,
                        "foundVersion": header.version,
                        "supportedVersion": CONFIG_STORE_FORMAT_VERSION,
                    })));
                }
                serde_json::from_slice::<ConfigFileState>(&bytes).map_err(&invalid_store)?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ConfigFileState::default()
            }
            Err(error) => {
                return Err(store_io_error(&path, "read", &error));
            }
        };
        Ok(Self {
            path: Some(path),
            state,
            rotation: BTreeMap::new(),
            verify_attempts: BTreeMap::new(),
        })
    }

    pub fn is_persistent(&self) -> bool {
        self.path.is_some()
    }

    pub fn generation(&self) -> u64 {
        self.state.generation
    }

    pub fn telemetry_config(&self) -> &TelemetryConfig {
        &self.state.telemetry
    }

    /// Persist deployment-owned telemetry policy beside the app database.
    ///
    /// @ref LLP 0154#deliverables-checklist-phase-1 — telemetry
    /// resource limits are ordinary local config and share neither the app
    /// database nor commercial capability state.
    pub fn set_telemetry_config(
        &mut self,
        config: TelemetryConfig,
    ) -> SnapbackResult<WriteOutcome> {
        config.validate()?;
        let value_changed = self.state.telemetry != config;
        if value_changed {
            let mut state = self.state.clone();
            state.telemetry = config;
            state.generation = next_generation(state.generation)?;
            self.persist_state(&state)?;
            self.state = state;
        }
        Ok(WriteOutcome {
            value_changed,
            generation: self.state.generation,
        })
    }

    pub fn entry(&self, name: &str) -> Option<&StoredEntry> {
        self.state.entries.get(name)
    }

    pub fn entry_revision(&self, name: &str) -> Option<u64> {
        self.entry(name).map(|entry| entry.revision)
    }

    /// Value material for the runtime grant path — the one value exit.
    ///
    /// @ref LLP 0036#runtime-exposure-d5-d8 — values reach handler code only
    /// through granted `ctx.secrets` handles; ops surfaces get names/status.
    pub fn values(&self, name: &str) -> Option<&[String]> {
        self.state
            .entries
            .get(name)
            .map(|entry| entry.values.as_slice())
    }

    /// Set an entry (replace) or add a pool member (append). Any value change
    /// resets verification: it attested the old values.
    pub fn set(
        &mut self,
        name: &str,
        values: Vec<String>,
        append: bool,
        source: &str,
        now_ms: u64,
    ) -> SnapbackResult<WriteOutcome> {
        if values.is_empty() || values.iter().any(|value| value.trim().is_empty()) {
            return Err(SnapbackError::error(
                "SNAPBACK_CONFIG_VALUE_INVALID",
                "config",
                format!("config entry {name} was given an empty value"),
            ));
        }
        let mut next = match (append, self.state.entries.get(name)) {
            (true, Some(existing)) => {
                let mut merged = existing.values.clone();
                merged.extend(values);
                merged
            }
            _ => values,
        };
        next.retain(|value| !value.is_empty());
        let value_changed = self
            .state
            .entries
            .get(name)
            .map(|existing| existing.values != next)
            .unwrap_or(true);
        let mut state = self.state.clone();
        let revision = next_generation(state.generation)?;
        let entry = StoredEntry {
            values: next,
            revision,
            set_at_ms: now_ms,
            source: source.to_owned(),
            verified: None,
        };
        state.entries.insert(name.to_owned(), entry);
        state.generation = revision;
        self.persist_state(&state)?;
        self.state = state;
        Ok(WriteOutcome {
            value_changed,
            generation: self.state.generation,
        })
    }

    /// Remove an entry entirely. Removing an entry that is not set is a no-op
    /// that still reports `value_changed: false`.
    pub fn unset(&mut self, name: &str) -> SnapbackResult<WriteOutcome> {
        let mut state = self.state.clone();
        let value_changed = state.entries.remove(name).is_some();
        if value_changed {
            state.generation = next_generation(state.generation)?;
            self.persist_state(&state)?;
            self.state = state;
        }
        Ok(WriteOutcome {
            value_changed,
            generation: self.state.generation,
        })
    }

    pub fn record_verification(
        &mut self,
        name: &str,
        record: VerificationRecord,
    ) -> SnapbackResult<()> {
        let Some(revision) = self.entry_revision(name) else {
            return Ok(());
        };
        self.record_verification_if_revision(name, revision, record)
            .map(|_| ())
    }

    /// Record a detached verification only when the exact staged value still
    /// exists. The revision is opaque and contains no derivation of the secret.
    ///
    /// @ref LLP 0036#status-model-and-app-visibility-d4 — verification attests
    /// one value identity and is invalidated by every set/unset transition.
    pub fn record_verification_if_revision(
        &mut self,
        name: &str,
        expected_revision: u64,
        record: VerificationRecord,
    ) -> SnapbackResult<bool> {
        let mut state = self.state.clone();
        if let Some(entry) = state.entries.get_mut(name) {
            if entry.revision != expected_revision {
                return Ok(false);
            }
            // Probes run off-lock (ENG-23493), so a hung run can finish after
            // a newer retry already recorded; a record never replaces one
            // with a later cooldown-claim stamp.
            if entry
                .verified
                .as_ref()
                .is_some_and(|existing| existing.at_ms > record.at_ms)
            {
                return Ok(true);
            }
            entry.verified = Some(record);
            self.persist_state(&state)?;
            self.state = state;
            return Ok(true);
        }
        Ok(false)
    }

    /// Defense-in-depth for diagnostic sinks. A handler deliberately using
    /// `expose()` can put a secret in thrown text; anonymous projections never
    /// carry messages, and gated diagnostic storage additionally replaces all
    /// currently configured values before retention.
    pub fn redact_text(&self, text: &str) -> String {
        self.secret_redactor().redact_text(text)
    }

    pub(crate) fn secret_redactor(&self) -> SecretRedactor {
        SecretRedactor::new(
            self.state
                .entries
                .values()
                .flat_map(|entry| entry.values.iter().cloned())
                .collect(),
        )
    }

    pub(crate) fn secret_redactor_for(&self, names: &[String]) -> SecretRedactor {
        SecretRedactor::new(
            names
                .iter()
                .filter_map(|name| self.state.entries.get(name))
                .flat_map(|entry| entry.values.iter().cloned())
                .collect(),
        )
    }

    pub fn redact_diagnostic(
        &self,
        diagnostic: crate::diagnostic::Diagnostic,
    ) -> crate::diagnostic::Diagnostic {
        self.secret_redactor().redact_diagnostic(diagnostic)
    }

    /// One-time import from the deprecated `SNAPBACK_ACTION_SECRETS` blob:
    /// only runs while the store has never been written, only imports declared
    /// names, and reports what it ignored.
    ///
    /// @ref LLP 0036#implementation-order — v1 slice item 2: the env blob is
    /// an import *source*, after which it is deprecated.
    pub fn import_env_blob(
        &mut self,
        blob: &serde_json::Map<String, serde_json::Value>,
        declared: &[String],
        now_ms: u64,
    ) -> SnapbackResult<EnvImportOutcome> {
        let mut imported = Vec::new();
        let mut ignored = Vec::new();
        if self.state.generation != 0 || !self.state.entries.is_empty() {
            return Ok(EnvImportOutcome {
                imported,
                ignored,
                skipped_existing_store: true,
            });
        }
        let mut state = self.state.clone();
        let mut import_revision = None;
        for (name, value) in blob {
            if !declared.contains(name) {
                ignored.push(name.clone());
                continue;
            }
            let values = match value {
                serde_json::Value::String(single) if !single.trim().is_empty() => {
                    vec![single.clone()]
                }
                serde_json::Value::Array(members)
                    if !members.is_empty()
                        && members.iter().all(|member| {
                            member
                                .as_str()
                                .is_some_and(|member| !member.trim().is_empty())
                        }) =>
                {
                    members
                        .iter()
                        .map(|member| member.as_str().unwrap().to_owned())
                        .collect()
                }
                _ => Vec::new(),
            };
            if values.is_empty() {
                ignored.push(name.clone());
                continue;
            }
            let revision = match import_revision {
                Some(revision) => revision,
                None => {
                    let revision = next_generation(state.generation)?;
                    import_revision = Some(revision);
                    revision
                }
            };
            state.entries.insert(
                name.clone(),
                StoredEntry {
                    values,
                    revision,
                    set_at_ms: now_ms,
                    source: "env-import".to_owned(),
                    verified: None,
                },
            );
            imported.push(name.clone());
        }
        if let Some(import_revision) = import_revision {
            state.generation = import_revision;
            self.persist_state(&state)?;
            self.state = state;
        }
        Ok(EnvImportOutcome {
            imported,
            ignored,
            skipped_existing_store: false,
        })
    }

    /// Bump and return the round-robin cursor for a pool entry — one bump per
    /// granted invocation, so `ctx.secrets.rotating()` walks the pool.
    pub fn next_rotation_cursor(&mut self, name: &str) -> u64 {
        let cursor = self.rotation.entry(name.to_owned()).or_insert(0);
        let current = *cursor;
        *cursor = cursor.wrapping_add(1);
        current
    }

    /// Enforce the per-entry verify cooldown; records the attempt on success.
    pub fn check_verify_cooldown(&mut self, name: &str, now_ms: u64) -> SnapbackResult<()> {
        if let Some(last) = self.verify_attempts.get(name) {
            let elapsed = now_ms.saturating_sub(*last);
            if elapsed < VERIFY_COOLDOWN_MS {
                return Err(SnapbackError::error(
                    "SNAPBACK_CONFIG_VERIFY_COOLDOWN",
                    "config",
                    format!(
                        "config entry {name} was verified {elapsed}ms ago; wait {}ms between probe runs",
                        VERIFY_COOLDOWN_MS
                    ),
                ));
            }
        }
        self.verify_attempts.insert(name.to_owned(), now_ms);
        Ok(())
    }

    /// Atomic replace with owner-only permissions: write a 0600 temp sibling,
    /// then rename over the store file.
    fn persist_state(&self, state: &ConfigFileState) -> SnapbackResult<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let bytes = serde_json::to_vec_pretty(state).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CONFIG_STORE_IO",
                "config",
                "config store state could not be serialized",
            )
            .with_details(serde_json::json!({ "error": error.to_string() }))
        })?;
        let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
        write_owner_only(&tmp, &bytes).map_err(|error| store_io_error(&tmp, "write", &error))?;
        std::fs::rename(&tmp, path).map_err(|error| {
            let _ = std::fs::remove_file(&tmp);
            store_io_error(path, "rename", &error)
        })?;
        crate::secure_file::sync_parent(path)
            .map_err(|error| store_io_error(path, "sync parent", &error))?;
        Ok(())
    }
}

fn next_generation(current: u64) -> SnapbackResult<u64> {
    current.checked_add(1).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CONFIG_GENERATION_EXHAUSTED",
            "config",
            "config generation space is exhausted; refusing to reuse a value identity",
        )
    })
}

fn redact_value_strings(redactor: &SecretRedactor, value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => *text = redactor.redact_text(text),
        serde_json::Value::Array(values) => {
            for value in values {
                redact_value_strings(redactor, value);
            }
        }
        serde_json::Value::Object(values) => {
            for value in values.values_mut() {
                redact_value_strings(redactor, value);
            }
        }
        _ => {}
    }
}

/// Names-only facts of an env-blob import.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EnvImportOutcome {
    pub imported: Vec<String>,
    pub ignored: Vec<String>,
    pub skipped_existing_store: bool,
}

fn store_io_error(path: &Path, op: &str, error: &std::io::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CONFIG_STORE_IO",
        "config",
        format!("config store {op} failed for {}", path.display()),
    )
    .with_details(serde_json::json!({ "error": error.to_string() }))
}

fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    crate::secure_file::write_owner_only(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &tempfile::TempDir) -> ConfigStore {
        ConfigStore::open(dir.path().join("dev.sqlite3.config.json")).unwrap()
    }

    #[test]
    fn set_persists_atomically_and_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let outcome = store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 42)
            .unwrap();
        assert!(outcome.value_changed);
        assert_eq!(outcome.generation, 1);

        let reloaded = store_in(&dir);
        assert_eq!(reloaded.values("caltrainFeed"), Some(&["key-1".into()][..]));
        assert_eq!(reloaded.generation(), 1);
        assert_eq!(reloaded.entry("caltrainFeed").unwrap().source, "http");
    }

    #[test]
    fn failed_persist_does_not_mutate_memory() {
        let dir = tempfile::tempdir().unwrap();
        let missing_parent = dir.path().join("missing");
        let mut store = ConfigStore::open(missing_parent.join("dev.sqlite3.config.json")).unwrap();

        let error = store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 42)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_STORE_IO");
        assert_eq!(store.generation(), 0);
        assert_eq!(store.values("caltrainFeed"), None);

        let mut memory = ConfigStore::in_memory();
        memory
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        let mut failing = ConfigStore {
            path: Some(missing_parent.join("verify.sqlite3.config.json")),
            state: memory.state.clone(),
            rotation: BTreeMap::new(),
            verify_attempts: BTreeMap::new(),
        };
        let before = failing.state.clone();
        let error = failing
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: true,
                    at_ms: 2,
                    diagnostic: None,
                },
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_STORE_IO");
        assert_eq!(failing.state, before);
    }

    #[cfg(unix)]
    #[test]
    fn store_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 42)
            .unwrap();
        let mode = std::fs::metadata(dir.path().join("dev.sqlite3.config.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn existing_store_is_repaired_and_symlink_substitution_is_refused() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let mut store = ConfigStore::open(path.clone()).unwrap();
        store
            .set("caltrainFeed", vec!["secret".to_owned()], false, "test", 1)
            .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let reopened = ConfigStore::open(path.clone()).unwrap();
        assert_eq!(reopened.values("caltrainFeed").unwrap(), ["secret"]);
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let link = dir.path().join("store-link.json");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        let error = ConfigStore::open(link).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_STORE_IO");
    }

    #[test]
    fn append_grows_the_pool_and_resets_verification() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        store
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: true,
                    at_ms: 2,
                    diagnostic: None,
                },
            )
            .unwrap();
        assert!(store.entry("caltrainFeed").unwrap().verified.is_some());

        let outcome = store
            .set("caltrainFeed", vec!["key-2".into()], true, "http", 3)
            .unwrap();
        assert!(outcome.value_changed);
        assert_eq!(
            store.values("caltrainFeed"),
            Some(&["key-1".into(), "key-2".into()][..])
        );
        // Any value change resets verification — it attested the old values.
        assert!(store.entry("caltrainFeed").unwrap().verified.is_none());
    }

    #[test]
    fn stale_verification_never_overwrites_a_newer_record() {
        // ENG-23493: probes run off-lock, so a hung run's late failure can
        // race a newer retry's success; the older cooldown-claim stamp loses.
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        store
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: true,
                    at_ms: 10,
                    diagnostic: None,
                },
            )
            .unwrap();
        store
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: false,
                    at_ms: 5,
                    diagnostic: Some("SNAPBACK_ACTION_TIMEOUT: abandoned".into()),
                },
            )
            .unwrap();
        let verified = store.entry("caltrainFeed").unwrap().verified.as_ref();
        assert_eq!(verified.map(|record| record.ok), Some(true));
        assert_eq!(verified.map(|record| record.at_ms), Some(10));

        // A same-or-newer stamp still overwrites (the in-lock serial case).
        store
            .record_verification(
                "caltrainFeed",
                VerificationRecord {
                    ok: false,
                    at_ms: 10,
                    diagnostic: Some("newer run".into()),
                },
            )
            .unwrap();
        let verified = store.entry("caltrainFeed").unwrap().verified.as_ref();
        assert_eq!(verified.map(|record| record.ok), Some(false));
    }

    #[test]
    fn detached_verification_is_compare_and_set_by_entry_revision() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["value-a".into()], false, "http", 1)
            .unwrap();
        let staged_revision = store.entry_revision("caltrainFeed").unwrap();

        store
            .set("caltrainFeed", vec!["value-b".into()], false, "http", 2)
            .unwrap();
        let applied = store
            .record_verification_if_revision(
                "caltrainFeed",
                staged_revision,
                VerificationRecord {
                    ok: true,
                    at_ms: 3,
                    diagnostic: None,
                },
            )
            .unwrap();
        assert!(!applied, "a probe for value A must not attest value B");
        assert!(store.entry("caltrainFeed").unwrap().verified.is_none());

        // Delete/recreate is a new identity even if the text is restored.
        let replacement_revision = store.entry_revision("caltrainFeed").unwrap();
        store.unset("caltrainFeed").unwrap();
        store
            .set("caltrainFeed", vec!["value-b".into()], false, "http", 4)
            .unwrap();
        assert_ne!(
            store.entry_revision("caltrainFeed"),
            Some(replacement_revision)
        );
        assert!(
            !store
                .record_verification_if_revision(
                    "caltrainFeed",
                    replacement_revision,
                    VerificationRecord {
                        ok: true,
                        at_ms: 5,
                        diagnostic: None,
                    },
                )
                .unwrap()
        );
    }

    #[test]
    fn retained_diagnostics_redact_configured_values_recursively() {
        let mut store = ConfigStore::in_memory();
        store
            .set("apiKey", vec!["top-secret-value".into()], false, "test", 1)
            .unwrap();
        let diagnostic = store.redact_diagnostic(
            crate::diagnostic::Diagnostic::error(
                "SNAPBACK_TEST",
                "runtime",
                "request failed with top-secret-value",
            )
            .with_details(serde_json::json!({
                "nested": ["prefix top-secret-value suffix"]
            })),
        );
        let serialized = serde_json::to_string(&diagnostic).unwrap();
        assert!(!serialized.contains("top-secret-value"), "{serialized}");
        assert!(serialized.contains("[REDACTED]"), "{serialized}");
    }

    #[test]
    fn action_error_redaction_scrubs_private_failure_message_and_stack() {
        use crate::error_tracking::{FailureCarrierV1, PrivateFailureContextV1};

        let redactor = SecretRedactor::new(vec!["top-secret-value".to_owned()]);
        let error = SnapbackError::error(
            "SNAPBACK_HANDLER_FAILED",
            "runtime",
            "JavaScript handler failed",
        )
        .with_private_failure_context(PrivateFailureContextV1 {
            carriers: vec![FailureCarrierV1 {
                error_class: "Error".to_owned(),
                message: Some("vendor echoed top-secret-value".to_owned()),
                stack: Some("at handler (top-secret-value:1:1)".to_owned()),
                message_extraction_truncated: false,
                stack_extraction_truncated: false,
            }],
            app_refusal_tracking: None,
        });

        let redacted = redactor.redact_error(error);
        assert_eq!(redacted.diagnostic.details["message"], "[REDACTED]");
        let carrier = &redacted
            .private_failure_context()
            .expect("private failure context survives redaction")
            .carriers[0];
        assert_eq!(carrier.message.as_deref(), Some("vendor echoed [REDACTED]"));
        assert_eq!(
            carrier.stack.as_deref(),
            Some("at handler ([REDACTED]:1:1)")
        );
    }

    #[test]
    fn redaction_replaces_overlapping_values_longest_first() {
        let mut store = ConfigStore::in_memory();
        store
            .set("short", vec!["token".into()], false, "test", 1)
            .unwrap();
        store
            .set("long", vec!["token-extended".into()], false, "test", 2)
            .unwrap();

        assert_eq!(
            store.redact_text("vendor echoed token-extended"),
            "vendor echoed [REDACTED]"
        );
    }

    #[test]
    fn redaction_covers_reversible_encoded_and_normalized_forms() {
        #[derive(Deserialize)]
        struct RedactionCorpus {
            secret: String,
            variants: Vec<String>,
        }
        let corpus: RedactionCorpus = serde_json::from_str(include_str!(
            "../tests/fixtures/secret-redaction-encoded-forms.json"
        ))
        .expect("shared local/Cloudflare redaction corpus");
        let redactor = SecretRedactor::new(vec![corpus.secret]);

        for variant in corpus.variants {
            let diagnostic = format!("vendor echoed {variant}");
            let redacted = redactor.redact_text(&diagnostic);
            assert_eq!(redacted, "vendor echoed [REDACTED]", "{variant:?}");
        }

        assert_eq!(
            redactor.redact_text("vendor echoed unrelated café text"),
            "vendor echoed unrelated café text"
        );
        assert_eq!(
            redactor.redact_text("vendor echoed p+/%"),
            "vendor echoed p+/%",
            "a recognizable prefix alone must not be broadly removed"
        );
    }

    #[test]
    fn unchanged_set_reports_value_changed_false_but_still_bumps_generation() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        let outcome = store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 2)
            .unwrap();
        assert!(!outcome.value_changed);
        assert_eq!(outcome.generation, 2);
    }

    #[test]
    fn generation_exhaustion_fails_closed_without_reusing_an_entry_revision() {
        let mut store = ConfigStore::in_memory();
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        store.state.generation = u64::MAX;
        let before = store.state.clone();

        let error = store
            .set("caltrainFeed", vec!["key-2".into()], false, "http", 2)
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CONFIG_GENERATION_EXHAUSTED"
        );
        assert_eq!(store.state, before);

        let error = store.unset("caltrainFeed").unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CONFIG_GENERATION_EXHAUSTED"
        );
        assert_eq!(store.state, before);
    }

    #[test]
    fn unset_removes_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        store
            .set("caltrainFeed", vec!["key-1".into()], false, "http", 1)
            .unwrap();
        let outcome = store.unset("caltrainFeed").unwrap();
        assert!(outcome.value_changed);
        assert_eq!(store.values("caltrainFeed"), None);
        let outcome = store.unset("caltrainFeed").unwrap();
        assert!(!outcome.value_changed);
    }

    #[test]
    fn empty_values_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let error = store
            .set("caltrainFeed", vec!["  ".into()], false, "http", 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
        let error = store
            .set("caltrainFeed", Vec::new(), false, "http", 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VALUE_INVALID");
    }

    #[test]
    fn env_import_only_touches_a_never_written_store_and_only_declared_names() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(&dir);
        let blob = serde_json::json!({
            "caltrainFeed": ["key-1", "key-2"],
            "undeclaredThing": "value",
        });
        let outcome = store
            .import_env_blob(blob.as_object().unwrap(), &["caltrainFeed".to_owned()], 7)
            .unwrap();
        assert_eq!(outcome.imported, vec!["caltrainFeed".to_owned()]);
        assert_eq!(outcome.ignored, vec!["undeclaredThing".to_owned()]);
        assert!(!outcome.skipped_existing_store);
        assert_eq!(
            store.values("caltrainFeed"),
            Some(&["key-1".into(), "key-2".into()][..])
        );
        assert_eq!(store.entry("caltrainFeed").unwrap().source, "env-import");

        // A second import is a no-op: the store has been written.
        let outcome = store
            .import_env_blob(blob.as_object().unwrap(), &["caltrainFeed".to_owned()], 8)
            .unwrap();
        assert!(outcome.skipped_existing_store);
    }

    #[test]
    fn env_import_rejects_an_entire_array_with_invalid_members() {
        for invalid in [
            serde_json::json!(["key-1", 42, "key-2"]),
            serde_json::json!(["key-1", "  ", "key-2"]),
            serde_json::json!([]),
        ] {
            let mut store = ConfigStore::in_memory();
            let blob = serde_json::Map::from_iter([("caltrainFeed".to_owned(), invalid)]);
            let outcome = store
                .import_env_blob(&blob, &["caltrainFeed".to_owned()], 7)
                .unwrap();
            assert!(outcome.imported.is_empty());
            assert_eq!(outcome.ignored, vec!["caltrainFeed".to_owned()]);
            assert_eq!(store.values("caltrainFeed"), None);
            assert_eq!(store.state.generation, 0);
        }
    }

    #[test]
    fn rotation_cursor_walks_per_entry() {
        let mut store = ConfigStore::in_memory();
        assert_eq!(store.next_rotation_cursor("caltrainFeed"), 0);
        assert_eq!(store.next_rotation_cursor("caltrainFeed"), 1);
        assert_eq!(store.next_rotation_cursor("other"), 0);
    }

    #[test]
    fn verify_cooldown_blocks_rapid_probes() {
        let mut store = ConfigStore::in_memory();
        store.check_verify_cooldown("caltrainFeed", 1_000).unwrap();
        let error = store
            .check_verify_cooldown("caltrainFeed", 1_000 + VERIFY_COOLDOWN_MS - 1)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_VERIFY_COOLDOWN");
        store
            .check_verify_cooldown("caltrainFeed", 1_000 + VERIFY_COOLDOWN_MS)
            .unwrap();
    }

    #[test]
    fn malformed_store_file_is_a_loud_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dev.sqlite3.config.json");
        std::fs::write(&path, b"not json").unwrap();
        let error = ConfigStore::open(path).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CONFIG_STORE_INVALID");
    }

    #[test]
    fn telemetry_config_is_backward_compatible_validated_and_persistent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dev.sqlite3.config.json");
        std::fs::write(&path, br#"{"version":1,"generation":0,"entries":{}}"#).unwrap();
        let mut store = ConfigStore::open(path.clone()).unwrap();
        assert_eq!(store.telemetry_config(), &TelemetryConfig::default());

        let config = TelemetryConfig {
            max_days: 30,
            ..TelemetryConfig::default()
        };
        let outcome = store.set_telemetry_config(config.clone()).unwrap();
        assert!(outcome.value_changed);
        assert_eq!(ConfigStore::open(path).unwrap().telemetry_config(), &config);

        let invalid = TelemetryConfig {
            max_days: 30,
            priority_reserve: config.buffer_capacity,
            ..TelemetryConfig::default()
        };
        let error = store.set_telemetry_config(invalid).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_CONFIG_INVALID");
    }

    #[test]
    fn unsupported_store_versions_fail_before_values_are_exposed_or_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        for version in [0, CONFIG_STORE_FORMAT_VERSION + 1, u32::MAX] {
            let path = dir.path().join(format!("store-v{version}.json"));
            let bytes = serde_json::to_vec_pretty(&serde_json::json!({
                "version": version,
                "generation": 7,
                "entries": {
                    "futureSecret": {
                        "values": ["must-not-be-exposed"],
                        "setAtMs": 1,
                        "source": "future-binary"
                    }
                }
            }))
            .unwrap();
            std::fs::write(&path, &bytes).unwrap();

            let error = ConfigStore::open(path.clone()).expect_err("version must fail closed");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_CONFIG_STORE_VERSION_UNSUPPORTED"
            );
            assert_eq!(error.diagnostic.details["foundVersion"], version);
            assert_eq!(
                error.diagnostic.details["supportedVersion"],
                CONFIG_STORE_FORMAT_VERSION
            );
            assert_eq!(
                std::fs::read(&path).unwrap(),
                bytes,
                "refusing an unsupported format must preserve its original bytes"
            );
        }
    }

    #[test]
    fn database_sibling_path_is_mechanical() {
        assert_eq!(
            ConfigStore::path_for_database(Path::new(".snapback/dev.sqlite3")),
            PathBuf::from(".snapback/dev.sqlite3.config.json")
        );
    }
}
