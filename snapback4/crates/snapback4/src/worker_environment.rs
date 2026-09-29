//! Explicit child environment and streaming redaction, including chunk boundaries.
use snapback4_core::schema::Schema;
use std::{collections::{BTreeMap, BTreeSet}, io::{Read, Write}};

pub(crate) fn validate_environment(schema: &Schema) -> Result<(), String> { values(schema).map(|_| ()) }

// @ref LLP 3000.009#5.3 — named entries opt into individual declared secrets;
// the conventional generated runtime still hosts the complete registry.
pub(super) fn for_entry(source: &std::path::Path, declared: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>, String> {
    let text = std::fs::read_to_string(source).map_err(|e| format!("worker secrets: {e}"))?;
    let mut selected = BTreeMap::new();
    for names in text.lines().filter_map(|line| line.trim().strip_prefix("// snapback4 secrets:")) {
        for name in names.split(|c: char| c.is_whitespace() || c == ',').filter(|s| !s.is_empty()) {
            let value = declared.get(name).ok_or_else(|| format!("worker secrets: {name} is not a declared action, effect or route secret"))?;
            selected.insert(name.to_owned(), value.clone());
        }
    }
    Ok(selected)
}

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

pub(super) fn pipe(mut input: impl Read + Send + 'static, secrets: Vec<Vec<u8>>, name: String) {
    std::thread::spawn(move || {
        let mut redactor = Redactor::new(secrets);
        let mut bytes = [0; 4096];
        let output = std::io::stderr();
        let mut ready = Vec::new();
        let mut pending = Vec::new();
        let mut emit = |bytes: &[u8], eof: bool| -> std::io::Result<()> {
            pending.extend_from_slice(bytes);
            loop {
                let size = pending.iter().position(|b| *b == b'\n').map(|n| n + 1)
                    .or_else(|| (pending.len() >= 8192).then_some(8192))
                    .or_else(|| (eof && !pending.is_empty()).then_some(pending.len()));
                let Some(size) = size else { break; };
                let mut out = output.lock();
                write!(out, "[worker:{name}] ")?;
                out.write_all(&pending[..size])?;
                if pending[size - 1] != b'\n' { out.write_all(b"\n")?; }
                out.flush()?;
                pending.drain(..size);
            }
            Ok(())
        };
        loop {
            ready.clear();
            match input.read(&mut bytes) {
                Ok(0) => { let _ = redactor.write(&[], true, &mut ready); let _ = emit(&ready, true); break; }
                Ok(n) => {
                    if redactor.write(&bytes[..n], false, &mut ready).is_err() || emit(&ready, false).is_err() { break; }
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
