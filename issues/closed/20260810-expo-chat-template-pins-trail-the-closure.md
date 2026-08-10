# expo-chat template pinned `^0.1.16` inside the 0.1.17 closure

**Status:** Closed 2026-08-09 — not a defect in the stamping mechanism; a
resolution artifact of the run's own `create-snapback-app` fetch. Diagnosed and
disproved against published bytes; assertion tightened, no behavior change.
**Impact:** 1
**Urgency:** 1
**Ease:** 5
**Confidence:** 5
**Systems:** CLI, Templates, Packaging, Release
**Date:** 2026-08-10
**Related:** [0.1.17 closure receipt](../../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-closure-diagnosis.md),
[0.1.17 summary](../../demos/expo-golden-path-fixture/receipts/20260810-g4-external-0117-summary.md),
[LLP 0176 §G4](../../llp/0176-expo-messaging-golden-path.plan.md)

## Finding as recorded

The LLP 0176 G4 external rerun against live 0.1.17 recorded one new, cosmetic
observation: the scaffolded app's `package.json` declared `^0.1.16` roots while
the closure it shipped in was 0.1.17. Caret resolution on a `0.1.x` range
selected 0.1.17, so the resolved `bun.lock` held a coherent all-0.1.17 vector
and nothing broke. The receipt's inference was that "the template's declared
pins are not refreshed by the promotion lane, so they drift one closure
behind."

## Diagnosis: the pins are not stamped by the promotion lane at all

They are stamped at **scaffold** time, from the scaffolding CLI's own version.
`packages/snapback-cli/templates/*/package.json` carries the literal
placeholder `__SNAPBACK_VERSION__` for every Snapback root, and
`scaffoldApp` (`packages/snapback-cli/index.mjs`) rewrites each one to
`` `^${packageVersion()}` `` — where `packageVersion()` reads the installed
`@expo/snapback-cli`'s own `package.json`. A scaffold is therefore
self-consistent with the closure that produced it *by construction*; there is
no separate manifest, no promotion-lane substitution, and nothing that could
"drift one closure behind" on its own.

Three checks against published bytes confirm it:

- `npm pack @expo/snapback-cli@0.1.17` ships
  `templates/expo-chat/package.json` still carrying `__SNAPBACK_VERSION__`,
  and its own `version` is `0.1.17`. The published template is not
  pre-substituted.
- `npm view create-snapback-app@0.1.17 dependencies` is
  `{"@expo/snapback-cli": "0.1.17"}` — an **exact** pin, not a caret. A 0.1.17
  wrapper cannot load a 0.1.16 CLI, so it cannot stamp `^0.1.16`.
- Rerunning the published path with an isolated npm cache —
  `npm_config_cache=$PWD/.npmcache npx --yes create-snapback-app@latest
  probe-app --template expo-chat` — produces `^0.1.17` for all five roots and
  a `.gitignore` matching the template.

The only account consistent with every fact the receipt itself records is that
the run's host resolved the wrapper to `create-snapback-app@0.1.16` — a stale
`latest` packument or a retained `npm exec` tree, plausible because 0.1.17 was
published shortly before the run and the same hosts had run the 0.1.16 lane the
day before. That 0.1.16 wrapper pins `@expo/snapback-cli@0.1.16`, which stamped
`^0.1.16`; the app's own subsequent `bun install` then resolved those carets to
the by-then-current 0.1.17, which is exactly the coherent 0.1.17 lock the
receipt reports beside the 0.1.16 pins. A one-off, on the consumer side of the
registry.

## The `0.2.0` concern is real but is not about drift

The receipt notes the pins "would stop being cosmetic at a `0.2.0` boundary,
where `^0.1.16` would no longer reach the current closure." True — but under
semver's `0.x` rule `^0.1.17` would not reach `0.2.0` either. Caret on `0.1.x`
is an exact-minor range. Whatever the closure is renumbered to, a scaffold
pinned with a caret on a `0.1.x` version needs an explicit dependency bump to
cross a minor boundary. That is a property of the range operator, not of the
stamping, and correcting the stamp would not have changed it. Recording it here
so the next reader does not "fix" the wrong thing: if crossing `0.2.0`
transparently is wanted, the change is to the range operator the scaffolder
emits, and it deserves its own ticket.

## What changed in the repository

No behavior change — there was no defect to repair. One test was tightened.
`packages/snapback-cli/package.test.mjs` asserted the scaffolded pins matched
the *shape* `/^\^\d+\.\d+\.\d+/`, which passes on any stamped version including
a hardcoded one. It now asserts the *identity*: each scaffolded Snapback root
equals `` `^${the CLI's own version}` ``. That makes the self-consistency
argument above machine-checked instead of prose, and it is the assertion that
would actually fail if someone ever replaced the substitution with a literal.
