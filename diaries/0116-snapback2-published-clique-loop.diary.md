# Diary 0116: Clique on published Snapback 2

**Date:** 2026-09-05
**Author:** Codex (orchestration); fresh builder: GPT-6 Astra, xhigh
**Systems:** Snapback 2, reduced Clique M1–M3, React web
**Related:** LLP 1002 §7–§11, LLP 1007 §5, `benchmarks/runs/2026-09-05-snapback2-loop/`

## Preparation

The prerequisites landed as `cf390fc23`. This run uses the first public npm
release, `snapback2@0.0.1`, with `snapback2-darwin-arm64@0.0.1`. The package
includes the effects engine and the full media helper. The scoped brief is
React web and text-only; it is not the Expo/media capability benchmark and
has no competitor lane. The builder receives no source checkout or prior
implementation, and no steering after the brief.

The prerequisite work exposed two concrete loop problems. Missing media
helpers were reported by `test` as missing owner metadata; startup now
preserves the actual refusal. Derived verification repeatedly exercised
equivalent query/mutation intersections and reset the same seed for every
replay. Representative coverage is now explicit and bounded, policy checks
remain exhaustive within their declared budget, and missing evidence blocks.
The installed chat test fell from roughly 25 s to 9 s; the entire packed
consumer proof, including a mounted React live update, took 20.81 s. A larger
67-operation, 242-message production-profile fixture passed in 29.195 s.

The installed auth recipe now teaches Quarry and explains mutation reads
under the caller’s read rules. Local `why` output points to that recipe, and
CLI `why` refuses mutation execution. Hidden and missing ordinary responses
remain indistinguishable.

## Fresh build

The run started at 06:54:05 UTC and reached its 1,200-second deadline at
07:14:05 UTC. The loop bar is **not met**. The final backend receipt passes
all eight derived checks and two authored journeys. Eighteen API acceptance
groups, browser account checks, and the production build pass; the composite
browser feed/chat check fails waiting for a message in the second browser.
API assertions are builder-authored, not independent grading. In particular,
the retained-history test holds an in-memory copy, not browser persistence
evidence. No Expo, media, offline, comparison, or promotion claim follows.

Installation, Quarry diagnostics, seed setup, and backend verification were
usable within the clock. The builder corrected maintain syntax, ambiguous
indexes, TypeScript narrowing, and missing seed witnesses. A named spread
shape over a merged feed was rejected; spelling the fields explicitly worked.
That remains an unclassified compiler/guide limitation, not a proven defect.
The builder used timestamped rows for typing and split receipt queries from
message history to keep queries bounded. No Convex or Supabase lane ran, so
this diary makes no comparative speed claim. Exact and Contract were unused.

Three problems consumed the browser phase:

- Published default fetch used the client as the browser fetch receiver.
  Chromium rejected requests with `Illegal invocation`; an explicit wrapper
  let the builder continue. An independent synthetic-origin Chromium probe
  reproduced default failure and wrapper success without accessing the app.
  The default transport is now bound to the host global, with a regression
  covering auth, query, and SSE requests. This is a confirmed platform defect.
- Successful password logins consume a durable quota of eight globally and
  three per email per minute. Repeated three-user seed and acceptance logins
  reach it; the undifferentiated `E_AUTH_INVALID` encouraged the builder's
  login-to-signup fallback, producing `E_AUTH_EMAIL_TAKEN`. The counters were
  not inspected during the run, so this diagnosis is inferred from code and
  request sequence. The builder's claim that restarting clears a process-local
  quota is wrong: the quota is stored in SQLite. Follow-up: the login ticket.
- The app keeps all 14 rooms mounted and opens at least three SSE queries
  for each, plus receipt queries. Hidden rooms still subscribe. The selected
  room has no roster/history and the send input remains populated. Browser
  connection starvation is a strong inference, not proven without a network
  capture. Unnecessary hidden-room subscriptions are an app error; the
  platform's one-stream-per-query browser scaling merits investigation.

The builder also wrote token-store adapters with incorrect method names and
storage-key handling; those were app/test errors. Chromium installation was
an environment correction. Overlapping attempts prevent an honest precise
count of platform-attributed correction loops. The failed browser acceptance
already settles the bar.

The untouched brief, publication integrity, and run record are retained under
`benchmarks/runs/2026-09-05-snapback2-loop/`. The working app, screenshots, and
raw transcript remain under `/Users/ccheever/snapback2-clique-benchmark-20260905`.
The timed app is not patched after the deadline. Raw logs include fixture
sessions and are retained locally; the committed record contains only summary
evidence and content hashes. The browser transport fix is post-run work and
cannot turn this run green.

## Post-run release

The browser receiver fix landed as `2c4ac025e` and was published in both
`snapback2@0.0.2` and `snapback2-darwin-arm64@0.0.2`. Production qualification
passed in 129.8 s. A fresh npm install then passed default auth, query, and SSE
in Chromium 153, without a fetch wrapper. The runtime bundle hash matches
the independently checked build. Fifty-six client/assets tests pass, and
independent review found no material issue. `post-run-release.json` retains
that evidence separately from the timed 0.0.1 benchmark.

During prerequisite verification, the broad test script had one unchanged
media output-drain timeout failure under concurrent build load; its quiet
targeted retry passed. That observation is recorded in the existing flake
ticket. The complete script was not reported as unconditionally green.

## Full Clique improvement loop, 2026-09-06

The full three-backend run's evidence was recovered from the M5 Max black.
Its narrative-based holistic scores on Snapback 2 0.0.4 are Astra 64 versus
Convex 84 / Supabase 77, and Grok 57 versus 78 / 47. The score tables and
original scorer prompt are retained in
`benchmarks/runs/2026-09-05-clique-full-3x3/`. They are baseline observations,
not measurements of the fixes published since then in 0.0.6.

A fresh Astra-medium full Clique build now uses npm 0.0.6, isolated from the
repository and prior apps, under `/Users/ccheever/clique-improvement/` on the
office M1. Installation and `doctor` passed; M1 is underway. The canonical
brief still contains placeholder caps, so the builder records actual elapsed
time without inventing numeric cap compliance. This run's different hardware
and agent harness preclude a matched timing comparison to the baseline.

The baseline makes recovery and client integration a priority alongside the
already-landed media and query fixes. Current L7 review residue identifies
startup auth transitions that can skip offline metadata/resume, report login
failure after authentication succeeded, or expose predecessor held coverage
during a transition. An Astra-xhigh lane is reproducing and correcting these
against the current product; no new result is claimed yet.

Muse is an evidence limitation: the three earlier xhigh builders are still
live remotely, and a fresh ultra request explicitly falls back to xhigh.
The new SSH process also cannot read the locked Keychain credentials. Existing
sessions are preserved. An xhigh result cannot establish the user's ultra bar.
