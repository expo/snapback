# Make the membership manifest grammar fail closed

**Status:** Open
**Severity:** P1
**Systems:** RBAC, Schema manifests, Deployment, Codegen
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table and §Writes
**Marker:** security, schema

Security-relevant membership JSON silently ignores unknown fields.

`TableManifest`, `MembershipManifest`, `MembershipTransition`,
`MembershipLastHolder`, and `MembershipExpiry` in `src/manifest.rs` do not use
Serde's `deny_unknown_fields`. Because `TableManifest.membership` is optional,
`"membershp"` silently erases the entire declaration and all of its protection.
Nested typos such as `resourceTabel`, `lastHodler`, or `frmo` likewise disappear
instead of refusing activation.

The validator in `src/storage.rs` checks vocabulary membership and patch field
names, but it does not enforce the exact per-operation transition grammar. It
can accept empty or structurally unreachable entries and combinations of
`from`, `to`, and `fields` that the selected operation should require or
forbid. A security policy must not become weaker because an author misspelled
or omitted a member.

**Done when:**

- The outer table manifest and every nested membership object reject unknown
  fields while retaining the explicitly supported aliases.
- Activation validates the exact insert/setRole/remove/patch grammar,
  including required, optional, and forbidden members and non-empty arrays.
- Unreachable caller-class/target combinations are typed activation errors.
- Adversarial tests cover `membershp`, `resourceTabel`, `lastHodler`, `frmo`,
  and unknown nested fields, plus omitted, empty, and forbidden operation
  members.
- Codegen emits only the closed spelling and its generated schema matches the
  executable parser.
