# Snapback 4: Darwin wasm serde-family census rejects i64 envelope serialization

Date: 2026-10-04
Status: Open
Scope: Snapback 4, supplemental wasm attribution

On the Apartment mini (darwin-arm64), Rust 1.97.0, Node 24.18.0 and twiggy
0.8.0, this check fails on both unmodified `f2ec498379376421ce7f329c9efee972463cedc3`
and the RPF capability-fence fix:

```sh
node scripts/attribute-wasm.mjs --check-families --check-absent
```

The rejected family is:

```text
i64 serialize: serde_json::value::ser::Serializer, serde_json::ser::Serializer<&mut alloc::vec::Vec<u8>>
```

The base was extracted with `git archive` into `/tmp/rpf-census-baseline` and
built independently with the same tools. Logs are `/tmp/rpf-baseline-census.log`
and `/tmp/rpf-wasm-census.log`. No allowlist was broadened. The separate
`--check-absent` pass succeeds, and explicit symbol inspection confirms the
native reservation calculator is absent. This supplemental audit is outside
`scripts/test.sh` and does not invalidate its separately reported outcome.

Follow up by tracing the concrete i64 envelope caller and deciding whether to
remove the extra serializer or document a narrowly justified existing-envelope
exception under LLP 3000.002. Do not waive all primitive serializers.
