//! Explicit child environment and streaming redaction, including chunk boundaries.
use snapback4_core::schema::Schema;
use std::{collections::{BTreeMap, BTreeSet}, io::{Read, Write}};

pub(crate) fn validate_environment(schema: &Schema) -> Result<(), String> { values(schema).map(|_| ()) }

pub(super) fn values(schema: &Schema) -> Result<BTreeMap<String, String>, String> {
    let names: BTreeSet<_> = schema.action_specs.values().flat_map(|spec| &spec.work.secrets)
        .chain(schema.routes.values().flat_map(|spec| &spec.work.secrets))
        .chain(schema.effect_specs.values().flat_map(|spec| &spec.secrets)).collect();
    names.into_iter().map(|name| {
        let valid = name.bytes().next().is_some_and(|b| b.is_ascii_uppercase() || b == b'_')
            && name.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
        let reserved = ["SNAPBACK_", "SNAPBACK4_", "NODE_", "DYLD_", "LD_", "LC_"].iter().any(|prefix| name.starts_with(prefix))
            || matches!(name.as_str(), "PATH" | "HOME" | "TMPDIR" | "TMP" | "TEMP" | "LANG" | "TZ" | "SHELL" | "ENV" | "BASH_ENV" | "IFS" | "PWD" | "USER" | "LOGNAME");
        if !valid || reserved { return Err(format!("E_SECRET_MISSING: secret name {name} is reserved or invalid")); }
        let value = std::env::var(name).map_err(|_| format!("E_SECRET_MISSING: supply declared secret {name} in the supervisor's environment"))?;
        if value.is_empty() || value.len() > 65_536 { return Err(format!("E_SECRET_MISSING: declared secret {name} must contain 1–65536 UTF-8 bytes")); }
        Ok((name.clone(), value))
    }).collect()
}

struct Redactor { secrets: Vec<Vec<u8>>, pending: Vec<u8> }
impl Redactor {
    fn new(mut secrets: Vec<Vec<u8>>) -> Self {
        // Structured logs commonly JSON-escape newlines, quotes and backslashes.
        // Redact that representation too, without requiring a complete log line.
        let escaped: Vec<_> = secrets.iter().filter_map(|secret| {
            let text = std::str::from_utf8(secret).ok()?;
            let quoted = serde_json::to_string(text).ok()?;
            Some(quoted.as_bytes()[1..quoted.len() - 1].to_vec())
        }).collect();
        secrets.extend(escaped);
        secrets.retain(|s| !s.is_empty()); secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
        secrets.dedup();
        Self { secrets, pending: Vec::new() }
    }
    fn write(&mut self, chunk: &[u8], eof: bool, output: &mut impl Write) -> std::io::Result<()> {
        self.pending.extend_from_slice(chunk);
        let mut offset = 0;
        while offset < self.pending.len() {
            let rest = &self.pending[offset..];
            if !eof && self.secrets.iter().any(|secret| secret.len() > rest.len() && secret.starts_with(rest)) { break; }
            if let Some(secret) = self.secrets.iter().find(|secret| rest.starts_with(secret)) {
                output.write_all(b"[REDACTED]")?; offset += secret.len();
            } else { output.write_all(&rest[..1])?; offset += 1; }
        }
        self.pending.drain(..offset);
        output.flush()
    }
}

pub(super) fn pipe(mut input: impl Read + Send + 'static, secrets: Vec<Vec<u8>>) {
    std::thread::spawn(move || {
        let mut redactor = Redactor::new(secrets);
        let mut bytes = [0; 4096];
        let mut output = std::io::stderr();
        let mut ready = Vec::new();
        loop {
            ready.clear();
            match input.read(&mut bytes) {
                Ok(0) => { let _ = redactor.write(&[], true, &mut ready); let _ = output.write_all(&ready); break; }
                Ok(n) => {
                    if redactor.write(&bytes[..n], false, &mut ready).is_err() || output.write_all(&ready).is_err() { break; }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secrets_are_redacted_across_chunks_newlines_and_prefixes() {
        let source = b"before secret-with\nnewline after secret and secre";
        for width in 1..=source.len() {
            let mut redactor = Redactor::new(vec![b"secret".to_vec(), b"secret-with\nnewline".to_vec()]);
            let mut out = Vec::new();
            for chunk in source.chunks(width) { redactor.write(chunk, false, &mut out).unwrap(); }
            redactor.write(&[], true, &mut out).unwrap();
            assert_eq!(String::from_utf8(out).unwrap(), "before [REDACTED] after [REDACTED] and secre");
        }
    }

    #[test]
    fn structured_logs_redact_json_escaped_secrets_across_chunks() {
        let secret = "quoted\"secret\\with\nnewline";
        let source = serde_json::json!({ "secret": secret }).to_string();
        for width in 1..=source.len() {
            let mut redactor = Redactor::new(vec![secret.as_bytes().to_vec()]);
            let mut out = Vec::new();
            for chunk in source.as_bytes().chunks(width) { redactor.write(chunk, false, &mut out).unwrap(); }
            redactor.write(&[], true, &mut out).unwrap();
            assert_eq!(String::from_utf8(out).unwrap(), r#"{"secret":"[REDACTED]"}"#);
        }
    }
}
