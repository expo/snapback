# Root JavaScript production dependency audit is red and absent from the canonical proof

**Opened:** 2026-08-08 · **Severity:** P1 (supply-chain security) · **Area:** JavaScript packages / proof

## What

At the repository root, the pinned Bun toolchain reports:

```text
$ bun audit --production
7 vulnerabilities (5 high, 2 moderate)
```

The affected locked packages are:

| package | locked version | reported range / path |
| --- | --- | --- |
| `fast-uri` | 3.1.3 | `<3.1.5`; `@expo/snapback-app-cli` → `ajv` (two high host-confusion advisories) |
| `image-size` | 1.2.1 | `<=2.0.2`; Expo / React Native peer closure (two high parser-loop DoS advisories) |
| `nanoid` | 3.3.16 | `<3.3.17`; Vite / Expo closure (high zero-size generator loop) |
| `postcss` | 8.5.22 | `<=8.5.22`; Vite / Expo closure (moderate source-map file-read advisory) |
| `uuid` | 7.0.3 | `<11.1.1`; Expo closure (moderate supplied-buffer bounds advisory) |

The root production audit is not a canonical-proof gate. The proof runs
`cargo audit --deny unmaintained`, and the optional Exact/admin acceptance gate
runs `bun run audit:production` only inside `admin-ui`; neither covers the
published workspace package closure. Therefore this state can land while the
normal dependency and package gates remain green.

`fast-uri` is in a direct published production dependency path through
`@expo/snapback-app-cli`'s `ajv`. The Expo/Vite findings need reachability and
packaging triage because Bun includes installed optional peer closures; they
must not be silently dismissed merely because some vulnerable functions are
tooling-shaped.

## Fix

1. Upgrade or override every fixable locked dependency and regenerate
   `bun.lock`; record an explicit disposition for anything with no patched
   compatible release.
2. Add a root `bun audit --production` gate to the canonical proof, selected
   by `bun.lock`, root/package manifests, and publication changes.
3. If optional peer installations create false-positive production scope,
   split the audit into published-package closures rather than weakening the
   severity threshold globally.

## Acceptance

- `bun audit --production` is green, or every remaining advisory has a
  checked, time-bounded disposition that names reachability and upstream fix
  status.
- The canonical proof fails when a root published-package production
  dependency becomes newly vulnerable.
- A fixture proves the gate cannot disappear when Exact/admin gates are not
  selected.

## Confidence

High on the red audit and missing gate; high that `fast-uri` is in a published
production path. Medium on exploitability of the Expo/Vite peer-closure
findings until their shipped/install-time reachability is traced.

## Resolution (2026-08-08)
Fixed on main (Lane K). fast-uri/nanoid/postcss bumped via overrides to patched versions; image-size and uuid have no compatible patched release (pinned by Metro ^1.0.2 and xcode ^7.0.3 respectively) and carry time-bounded reachability dispositions expiring 2026-09-08 (re-check then). Added scripts/check-js-production-audit.mjs (fails on undispositioned high/critical, validates disposition severity/range/version/expiry/docs, stable SNAPBACK_JS_PRODUCTION_AUDIT_* diagnostics), wired into the canonical proof + selection policy (publication + workspace groups) with a selector fixture. Verified: frozen install clean; gate PASS on fixed tree, exit 1 on injected advisory; selection fixtures 10/10; ref-check clean.

**Follow-up:** the image-size/uuid dispositions expire 2026-09-08 — re-check upstream patched releases then.
