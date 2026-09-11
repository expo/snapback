# Snapback 2 effect Intl declarations exceed the witnessed runtime

**Status:** Open
**Priority:** P1
**Owner:** Snapback 2 effects / Ibex 2
**Date:** 2026-09-11
**Related:** LLP 1003 §1 and §3; expo/ibex LLP 0067; `expo/ibex/issues/20260911-linux-hermes-intl-numberformat-stub.md`

## Reproduction and scope

The Linux-publication investigation compared the selected TypeScript 5.9.2
declaration closure against the actual vanilla-Hermes runtime. The package's
`collectEffectLib("es2020")` includes declarations for `Intl.PluralRules`
(`lib.es2018.intl.d.ts`) and `Intl.RelativeTimeFormat`, `Intl.Locale` and
`Intl.DisplayNames` (`lib.es2020.intl.d.ts`; DisplayNames at lines 356–447).
All four constructors are absent from the existing Linux and Mac runtimes:

```js
JSON.stringify(["PluralRules", "RelativeTimeFormat", "Locale", "DisplayNames"]
  .map(name => [name, typeof Intl[name]]))
// Each reports "undefined" on both hosts.
```

The same sparse probe found inherited Mac NumberFormat gaps: no
`formatToParts`, ignored `signDisplay`/compact notation, and a requested
`kilometer-per-hour` unit converted to miles per hour. Existing BigInt locale
formatting returns ungrouped digits on both hosts. These are distinct from
the newly exposed Linux NumberFormat, locale-case and date-parts stubs being
replaced in the current native-Intl commission. Do not close this issue merely
because that Linux delta passes its focused tests.

The bounded audit and original probe inputs/outputs are retained with the
[release record](../benchmarks/runs/2026-09-11-snapback2-release-0024-linux/README.md).
The initial Linux executable is SHA-256
`c14809eac4259c0c99d8b4f42ece1fd702549356a06affaac6b85ef843bcb061`.
The sparse Mac probe completed successfully; two supplementary probes in an
older Mac debug CLI exited 139 and are retained, not used as positive evidence
or attributed to the new implementation.

## Follow-up

Reconcile each admitted Intl constructor/member with a compile-and-execute
witness on both supported native hosts. Implement missing behavior through the
existing native boundary or obtain an explicit authored-surface decision;
do not silently remove types or substitute fake results. Preserve meaningful
Mac behavior while closing its gaps. A successful top-level `Intl` witness is
not evidence for every constructor in the TypeScript namespace, and the
ES2020 type-library selection is not a blanket ECMA-402 conformance claim.

No new witness registry, gate or broad conformance program is commissioned by
this ticket. Keep the current release's bounded implementation and its
qualification evidence separate from this inherited follow-up.
