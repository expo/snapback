# Exact depends on snapback4 crates through a private git URL

**Opened:** 2026-10-30 · **Source:** the Exact team's Snapback 4 dogfood report (shared entry, High) · **Fence:** Snapback 4 · **Status:** open, needs an author ruling

## Report

Exact's `snapback4/Cargo.toml` pins `snapback4-core`, `snapback4-device` and
`snapback4-lang` as `git = "https://github.com/expo/snapback.git", rev = …`.
This repository is private, so Exact's setup fails at `cargo fetch` on any
machine without GitHub credentials for it. `CARGO_NET_GIT_FETCH_WITH_CLI=true`
did not help on a Mac that uses SSH for GitHub: the error became
"revision … not found", which hides the login failure. The working fix needs a
`url.git@github.com:.insteadOf` override on every build (Exact
`docs/reference.md` and the closed Exact ticket
`issues/closed/20260924-root-lock-pins-private-snapback.md` record the same
workaround for Crew).

## Why it is not fixed in this landing

Every Snapback 4 crate is `publish = false`, and LLP 3000.005's open decision 2
("whether `snapback4-native` is published to crates.io now") has never been
ruled; the device and core crates were never considered for it. Publishing is
an irreversible, outward-facing act, so it is a ruling, not a fix-forward.

## Options

1. **Publish `snapback4-core`, `snapback4-lang`, `snapback4-device` (and
   `snapback4-native`) to crates.io** at each `snapback4` npm version, from
   `scripts/publish.mjs`. Exact pins `version = "=0.4.x"` with no git URL.
   Cost: the crates become a public API surface with semver expectations;
   `vendor/tiny_http` is a patched path dependency that would need publishing
   or replacing first.
2. **Exact vendors the three crates** (`cargo vendor` into its tree at each
   pin bump). No Snapback change; Exact carries ~the device's source.
3. **Keep git, document the credential recipe** in `snapback4/README.md` and
   Exact's setup script, and make Exact's error name the private-repository
   cause. Lowest cost, leaves every new machine's first build failing.

Recommendation: 1 if the repository is expected to stay private; 2 otherwise.
