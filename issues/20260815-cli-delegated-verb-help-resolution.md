# Third-level `--help` on delegated native CLI verbs prints the parent's help

**Status:** Open — delegated help resolved 2026-08-25; native carrier usage remains
**Opened:** 2026-08-15 · **Severity:** P3 · **Area:** CLI
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
`@expo/snapback-cli@0.1.22`.

## Problem

`snapback auth password reset --help` and `snapback auth password unlock
--help` print the **parent** `snapback auth` help, and `snapback auth
password --help` prints a mixed parent view. This contradicts the guide's
claim that help "selects the longest registered wrapper path"
(`guide/getting-started/the-authoring-loop.md`). The proof had to discover
`reset`'s flags by deliberately triggering a usage error.

Secondary papercut on that same error path: the bare usage line lists the
mutually exclusive password carriers (`--password-stdin`, `--password-fd
<N>`, `--__snapback-password-environment-carrier`) as if all three were
required, with no "choose one" marker.

## Desired resolution

- Help resolution walks to the longest registered verb path for delegated
  native verbs, matching the guide's documented behavior.
- Usage lines render mutually exclusive carrier groups as alternatives.
- If the guide's claim is instead narrowed, amend the guide page in the same
  landing.

## Implementation note (2026-08-25)

The delegated-help portion is resolved. Commit `158744901` had already stopped
the package-owned `auth` summary from shadowing native siblings; this lane adds
the missing registry walk, so options adjacent to `--help` cannot be mistaken
for command-path components, and guards the `auth password reset` and `unlock`
leaf paths in `packages/snapback-cli/cli-help.test.mjs`.

The carrier-usage papercut remains open because the text is emitted by native
Clap before the JS wrapper runs the delegated operation. The Rust site is
`AuthPasswordCarrierArgs` in `crates/snapback-cli/src/cli.rs`: its three
`required_unless_present_any` declarations make Clap list every carrier as
required in the missing-carrier diagnostic and concatenate all three into the
usage line. A Rust lane must preserve the existing conflicts and hidden
environment marker while rendering the group as alternatives with an explicit
choose-one marker.
