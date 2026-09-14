# Snapback 4: the README names `processDevice()` without its directory argument; the bare call throws

Status: Resolved
Priority: P3
Date: 2026-09-14
Systems: client package (`snapback4/native` opener), README
Observed version: published `snapback4@0.2.9`
Evidence status: received builder observation, three retained attempts

## Problem

The package README mentions `processDevice()` for a Node-hosted device but never states its
signature. The Clique Astra calibration on 0.2.9 called it with no argument and got
`dataDir.replace is not a function` on `undefined`; a string and an options object also failed
with diagnostic-guided guesses (`lanes/astra-snapback4/evidence/process-device-preflight{,2,3}.txt`).
The builder gave up and used the browser device for its cold-scale proof.

## Fix

State the signature where the README first names it (`processDevice({ dir })`, or whatever it
is), make the bare call refuse with one sentence naming the argument instead of a TypeError from
inside, and add the case to the periphery tests.

## Resolution — 2026-09-14 (CU3)

Replaced the positional opener with `processDevice({ dir, binary?, spawn?, writeFile? })`.
The required directory is checked synchronously; the exact refusal is
`processDevice needs { dir }: the directory its stores live in`. Node's spawn and file
writer load only on the default path, which creates the stores' directory. The CLI shim
and opener share binary resolution (environment, platform package, repository build).
Every live in-repo caller uses the options form. README §4 names the signature, includes
a complete Node example and explains `api.<module>.<op>`.

The new README example test typechecks every TypeScript fence against source and
requires calls to all 36 public functions. Positive process tests cover injected hosts,
default Node hosts, resolver precedence, persistence and cold offline reopen; invalid
directory inputs refuse before spawning. On base `518891fd1cc67b969a6f57b683e80efadc89b612`,
the bare call returned an opener and its first open threw exactly
`TypeError: Cannot read properties of undefined (reading 'replace')`; the original
problem paragraph preserves the builder's report rather than rewriting that evidence.

Verification: focused native/periphery/README suite **18 passed, 0 failed**; package
typecheck and build pass; all **11 README blocks / 36 public functions** check in
**877.03 ms** alone (**1308.50 ms** in the sequential client rerun). The full blocking
script reports **1 failing step in 666 s**: Rust **374 passed / 0 failed / 1 ignored**,
fixtures **9 / 0**, concurrent client tests **98 / 21**. Sequential client files give
**126 / 1**; all timing failures clear and Chromium startup SIGABRT remains, reproduced
by the unchanged React test from the exact base above (**0 / 1**). The lead must rerun
that browser check in a host where Chromium launches; no gate or timeout was changed.
