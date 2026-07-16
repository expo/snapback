# Redact reversible encoded secret forms on the local target

**Status:** Closed
**Severity:** P1
**Systems:** Config, Secrets, Actions, Diagnostics, Local runtime
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0009 §Secrets, LLP 0036 §Runtime exposure (D5, D8), ENG-24366
**Marker:** security

`SecretRedactor::redact_text` in `src/config.rs` replaces only the exact raw
secret string. Local action and cron error boundaries pass diagnostics through
that redactor, so a reversible transformation such as URL encoding, form
encoding, JSON escaping, Unicode escaping, or normalization can evade the
scrub. For example, an action can expose a configured value, throw
`encodeURIComponent(value)`, and return the encoded value in its public error
envelope even though the equivalent raw-value test passes.

The Cloudflare target already treats reversible encoding as a language in
`cloudflare/src/coordinator.js`: normalized forms, partial/mixed-case JSON
Unicode escapes, and two rounds of URL/form encoding are covered. The local
target needs the same security property without introducing an unbounded or
pathologically expensive matcher.

**Done when:**

- Local action, detached action, cron-retention, and config-verification error
  boundaries scrub the reversible forms covered by the Cloudflare corpus.
- Tests cover URL, double-URL, form, JSON short/Unicode, partial/mixed-case
  Unicode, NFC, NFD, BMP, and astral representations.
- Overlapping secrets remain longest-first and ordinary non-secret diagnostic
  text is not broadly prefix-redacted.
- The local and Cloudflare redaction corpora have an explicit parity guard or
  shared source of truth.

## Resolution

The local redactor now compiles longest-first matchers for raw, NFC/NFD,
JSON-short/Unicode (including mixed-case, partial, BMP, astral, and repeated
backslash forms), plus two rounds of URL/form encoding. Rust and Cloudflare
acceptance consume the same committed encoded-form corpus, and detached action
and cron tests now throw encoded secrets through their public/retained error
boundaries after configuration rotation.
