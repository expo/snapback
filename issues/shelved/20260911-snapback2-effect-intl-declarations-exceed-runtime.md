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

The bounded Linux DateTimeFormat replacement still maps `formatMatcher:
"basic"` and `"best fit"` to ICU best-pattern selection; it does not implement
the separate ECMA BasicFormatMatcher algorithm. This limitation predates the
replacement: the pinned Hermes
[PlatformIntlICU.cpp](https://github.com/facebook/hermes/blob/6badada762121682b5481b6124e6c3a991ae6046/lib/Platform/Intl/PlatformIntlICU.cpp#L401)
only comments the matcher branch and unconditionally uses
`udatpg_getBestPatternWithOptions` for component skeletons. Track the limitation
here without calling the current completion full Intl conformance.

### Deferred constructor edge in the Linux replacement

For both NumberFormat and DateTimeFormat, an exotic `Reflect.construct` target
whose `prototype` is not an object falls back to `Object.prototype`, rather
than the corresponding Intl prototype:

```js
function Target() {}
Target.prototype = 0;
Object.getPrototypeOf(Reflect.construct(Intl.NumberFormat, ["en"], Target))
// Object.prototype; expected Intl.NumberFormat.prototype.
```

Ordinary `new`, call-as-function and custom object-prototype subclasses are
preserved. Root accepted this review finding initially, then explicitly
deferred it after three correction attempts exposed a pinned-engine constraint:
[JSCallableProxy.cpp](https://github.com/facebook/hermes/blob/6badada762121682b5481b6124e6c3a991ae6046/lib/VM/JSCallableProxy.cpp#L78)
reads `newTarget.prototype` and allocates before looking up any construct trap.
A thin JS Proxy then needs a second observable read; descriptor heuristics
add observable proxy traps or confuse an explicitly supplied Object.prototype
with fallback. Public JSI has no custom constructor/newTarget callback.

Do not fix this with private-VM coupling, an engine fork, bytecode patching,
extra observable reads or heuristic prototype replacement under the present
commission. Retain the isolated expected-correct regression and original
failed attempts. Revisit with a clean engine/public-embedding constructor seam.
This is an explicitly unimplemented edge, not an optional legacy-constructor
feature or a passing conformance claim. Final code review receives the exact
limitation and may propose alternatives or challenge its severity.

The bounded audit and original probe inputs/outputs are retained with the
[release record](../../benchmarks/runs/2026-09-11-snapback2-release-0024-linux/README.md).
The initial Linux executable is SHA-256
`c14809eac4259c0c99d8b4f42ece1fd702549356a06affaac6b85ef843bcb061`.
The sparse Mac probe completed successfully; two supplementary probes in an
older Mac debug CLI exited 139 and are retained, not used as positive evidence
or attributed to the new implementation.

### Remaining normalization and function-shape edges

The Linux replacement ASCII-lowercases syntactically valid calendar/numbering
options, but does not perform complete UTS35 option-alias canonicalization.
For example, `calendar: "islamicc"` is treated as unsupported rather than
as `"islamic-civil"`; `"ethiopic-amete-alem"` likewise does not select
`"ethioaa"`. Use the canonical calendar name. With a requested Buddhist
extension plus the unsupported alias, Buddhist formatting remains selected.
This falls short of the selected 2020 ResolveLocale alias step, not merely a
spelling difference in metadata. Sol's final correction review reports it as
blocking; Grok calls it inherited/outside the bounded case-normalization
delta. Root records the real gap here and defers full alias handling beyond
this release, without claiming both reviewers returned READY or full Intl
conformance. Source: [2020 ResolveLocale](https://402.ecma-international.org/7.0/#sec-resolvelocale).

The unchanged Linux String locale-case wrappers remain ordinary constructable
functions. Their normal calls and Unicode mapping work, but their built-in
function shape is incomplete. The corrected nonconstructable callable claim
applies to NumberFormat/DateTimeFormat methods, accessors and bound formatters,
plus Number/BigInt/Date locale methods; it does not cover these String wrappers.
Follow-up tests should check `[[Construct]]` by using a method as newTarget,
so a body-level receiver-brand TypeError cannot masquerade as nonconstructability.

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
