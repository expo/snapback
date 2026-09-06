# Sanitized evidence / action trace

Credentials, tokens, control secrets, and raw auth state are omitted. Private copies (sqlite snapshot, redacted credential prefixes) stay under `grader-work/private/` and are not published.

## Actions (order)

1. Read RUN-INSTRUCTIONS.md, QUALIFICATION.md, SOURCE-IDENTITY.json, INSTALL-VERIFICATION.json, frozen instrument (assertions, applicability, grader schema, instrument-gap).
2. Hashed `app/` sources excluding node_modules / artifacts / .snapback → `grader-work/source-integrity-before.json`.
3. Recorded Node v25.9.0 and snapback2@0.0.8. Assigned ports 50800–50819 all free.
4. Started `node node_modules/snapback2/bin/snapback2.mjs dev --port 50800 --json` → PID 69630.
5. Configured shortened windows (editMs=60000, dayMs=180000) and production digest on the main owner.
6. Seeded `m1` (16), `m2` (52), `m3` (19) once. Invariants 27/27.
7. Password scan: `_credentials.hash` prefixes `$argon2id$v=`; 0 plaintext fixture passwords in persistence/bundle/source.
8. `expo export --platform web` → `app/artifacts/web`. Served `PORT=50801 BACKEND_URL=http://127.0.0.1:50800` PID 92902.
9. Generated `evidence/setup-identity.json` (toolchain only; no secrets).
10. Canonical `npm run acceptance -- --milestone mN` for m1–m6 and m8. Preserved m4/m5/m8 failures.
11. Coverage-manifest generation failed on m4 suite.pass=false.
12. Unmodified choreography startup: missing `../../lib/json-schema.mjs`. Loader-adapted choreography m1–m6, m8.
13. Independent API (`grader-work/independent-api.mjs`, `followup-api.mjs`, `digest-independent.mjs`) and browser (`independent-browser.mjs`).
14. Isolated clock 50806 + trending check; isolated digest 50808 + one shortened period.
15. `index-fixtures.mjs` only after empty-search evidence was recorded.
16. Source hash after: no product-source changes.
17. SIGTERM owned PIDs only.

## Suite / choreography receipts (paths)

- `app/evidence/suite-status.json`
- `app/evidence/m{1,2,3,4,5,6,8}-suite.json` and `*-coverage.json`
- `grader-work/evidence/m4-suite-attempt1.json`, `m5-suite-attempt1.json`, `m8-suite-attempt1.json`
- `app/evidence/m{1,2,3,4,5,6,8}-choreography.jsonl`
- `app/evidence/m6-push-proof.json` (no tokens; display names/handles only)
- `app/evidence/m6-custom-client.json` (pass flags only)
- `app/evidence/m8-insights-accounting.json`

## Independent receipts

- `grader-work/evidence/invariant-starter.json`
- `grader-work/evidence/independent-api.json` (redacted errors)
- `grader-work/evidence/independent-browser.json`
- `grader-work/evidence/followup-api.json`
- `grader-work/evidence/m3-remove-api.json`
- `grader-work/evidence/m4-video-api.json`
- `grader-work/evidence/m8-trending-independent.json`
- `grader-work/evidence/digest-independent.json`
- `grader-work/evidence/search-after-index.json`
- `grader-work/evidence/password-storage-scan.json`
- `grader-work/logs/*` (may contain stack traces; no passwords intended)

## Native (frozen)

- `qualification/m6-native-proof.json`
- `qualification/m8-native-proof.json`
- `qualification/m8-native-launch.png` (login screen)
- `qualification/instrument-gap.md`

## Redaction

Fixture passwords, bearer tokens, owner control secrets, and full argon2 hashes are not copied into this trace or `grader-report.json`. Emails of throwaway digest/clock users are omitted from the published report.
