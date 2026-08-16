# Integration fix 2 report

## Root cause

The failing `validCase` generates the `probe` Action as a module-form
`IbexModule`. The authoring path correctly recognizes `handler.ts` as an
admitted TypeScript handler and validates it with the pinned TypeScript parser,
but it preserves that admitted source on `runtime.IbexModule.source`.

The semantic-generation lane then sent every `IbexModule.source` through Acorn
with `sourceType: 'module'`. Acorn only accepts ECMAScript, so it rejected the
first TypeScript-only construct—the `type Result` alias—at line 2, column 5.
This was a canonicalizer coverage mismatch, not an invalid fixture or a
module-versus-script error.

## Source form

The exact legitimate emitted source form was a closed-script TypeScript handler:

```ts
type Result = { ok: boolean };
const initial: Result = { ok: true };
globalThis.__snapbackHandlers = {
  async probe(): Promise<Result> { return initial; },
};
```

The operation facts were:

- operation: `probe`
- kind: `Action`
- handler form: `module`
- runtime kind: `IbexModule`
- authored source: `handler.ts`

## Fix

`canonicalExecutableSource` still parses JavaScript directly with Acorn first.
If that parser rejects the source, the canonicalizer now tries the pinned
TypeScript compiler, refuses any TypeScript error diagnostic, erases
non-executable type/comment syntax, and parses the emitted JavaScript with
Acorn into the same canonical AST representation.

This preserves the evidence-versus-executable split: the raw TypeScript bytes
remain evidence inputs, while its executable meaning canonicalizes identically
to the type-erased JavaScript. It does not catch-and-skip failures; malformed
TypeScript and invalid emitted JavaScript still produce `CODEGEN_WRITE_FAILED`.

The regression test uses the exact `Result`/`initial`/`probe(): Promise<Result>`
form, asserts equality with its emitted JavaScript form, and separately asserts
that malformed TypeScript refuses.

## Verification

All required commands passed:

- `env -u FORCE_COLOR node packages/snapback-codegen/authoring-validation.test.mjs`
- `env -u FORCE_COLOR node packages/snapback-codegen/semantic-generation-golden.test.mjs`
- `env -u FORCE_COLOR node packages/snapback-codegen/semantic-generation-rotation.test.mjs`
- `env -u FORCE_COLOR npm test --workspace @expo/snapback-codegen`
- `./ref-check --verbose`
- `git diff --check`

Complete codegen package-chain result, verbatim tail:

```text
protected query profile tests passed
retainability profile tests passed
dependency-graph.test.mjs: all cases passed
contract-output-mode.test.mjs: all cases passed
contract-binding-reads.test.mjs: all cases passed
receipt-capability.test.mjs: all cases passed
jobs-authoring.test.mjs: all cases passed
sequence-authoring.test.mjs: declaration, v3 identity, and capability checks passed
provider introspection tests passed
operation-schemas.test.mjs: all cases passed
app-descriptor.test.mjs: all cases passed
app-inspection.test.mjs: all cases passed
remote-service-publication.test.mjs: all cases passed
data-tier-corpus.test.mjs: 37 cases verified; builder-parity assertions passed
✔ auth v1 cross-language crypto vectors remain exact (1.571792ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6.198542
codegen review surface: cold cache, tamper, legacy, custody, failure atomicity, and summaries verified
```

## Golden changes

No golden vector changed and no regeneration was needed. The committed semantic
generation vectors and the full rotation matrix passed unchanged; only the new
exact-form regression test was added.

---

# LLP 0262 Stage 1 Lane B second review-fix verification

## Full snapback-vite package suite

Command:

```sh
SNAPBACK_CLIENT_RQS_DIR=/private/tmp/snapback-vite-rqs-review-fix2-impl0262-b bun run --cwd packages/snapback-vite test
```

Exit status: 0

Verbatim output:

```text
$ node dev-identity-relay.test.mjs && node package.test.mjs && node channel-a.test.mjs && node rqs-serializer.test.mjs && bun bun-relay.test.mjs
dev identity relay: HTTP /connection/open + request re-read + WS upgrade stamp and overwrite pass
dev identity relay: Vite defaults and exact carriers stay denied; fs.strict=false refuses stamping
dev identity relay: managed descriptor + owner-only sidecar stamp; unsafe carriers refuse harvest
dev identity relay: absent handoff warns once and strips a client-supplied capability
allowlist matrix: app-data forwards, system/admin refused
virtual module sanitized; factory validation refuses bad config
managed spawn + ready handshake + host-ops bring-up pass
proxy allowlist: refusals structured, app-data ephemeral routes forward
WebSocket live stream relays through /__snapback
virtual:snapback/dev is sanitized
attach/external validation: mismatch, destructive opt-in, and ready-file fencing refuse correctly
auto attach: non-destructive, and teardown spares the attached server
closing Vite tears down only the plugin-spawned managed child
package.test.mjs: allowlist, managed lifecycle, proxy + WS relay, attach fencing, and sanitization pass
✔ matches exact patterns and binds percent-decoded params (1.724167ms)
✔ normalizes the fallback document and the configured base (0.127833ms)
✔ publicInline eligibility reads the codegen-compiled function fact (0.144042ms)
✔ injects the boot payload as a non-executable data block before </head> (0.259583ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6.90075
✔ fixture corpus is present and complete (1.182583ms)
✔ fixture 001-script-close-value serializes byte-exactly (literal </script> and <script> inside a string value) (1.149625ms)
✔ fixture 002-script-close-key serializes byte-exactly (literal </script><script> as an object property name) (0.326542ms)
✔ fixture 003-mixed-case serializes byte-exactly (mixed-case script terminators (HTML tag names are case-insensitive)) (0.357958ms)
✔ fixture 004-escaped-slash serializes byte-exactly (backslash before the slash: the < must still be escaped and the backslash preserved) (0.350459ms)
✔ fixture 005-comment-open serializes byte-exactly (comment-opening sequence <!-- in string values) (0.407667ms)
✔ fixture 006-comment-close serializes byte-exactly (comment-closing sequence --> in a string value) (0.302292ms)
✔ fixture 007-nested serializes byte-exactly (dangerous keys and values at depth in nested objects and arrays) (0.635875ms)
✔ fixture 008-unicode-separators serializes byte-exactly (raw U+2028/U+2029 in a value and in a property name) (0.326916ms)
✔ fixture 009-kitchen-sink serializes byte-exactly (composite: terminators, comments, escaped-slash, separators, quotes, backslashes, controls, raw UTF-8 passthrough) (0.336ms)
✔ whole-output byte property rejects reintroduced literals (0.216083ms)
✔ escapes apply to property names, not only values (0.044084ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10.253167
bun-relay: Bun 1.3.12 runtime confirmed
bun-relay: temporary app generated by the Node 24 child
bun-relay: managed backend and real Bun-backed Vite server ready
[bun] Warning: ws.WebSocket 'unexpected-response' event is not implemented in bun
bun-relay: durable live_replace arrived after a proxied mutation
bun-relay: websocket upgrade to a refused system route failed closed
bun-relay.test.mjs: Bun Vite websocket relay + 403 upgrade refusal pass
```

## Dev-identity relay tests

Command:

```sh
node packages/snapback-vite/dev-identity-relay.test.mjs
```

Exit status: 0

Verbatim output:

```text
dev identity relay: HTTP /connection/open + request re-read + WS upgrade stamp and overwrite pass
dev identity relay: Vite defaults and exact carriers stay denied; fs.strict=false refuses stamping
dev identity relay: managed descriptor + owner-only sidecar stamp; unsafe carriers refuse harvest
dev identity relay: absent handoff warns once and strips a client-supplied capability
```
