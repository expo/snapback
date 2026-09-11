The current public macOS release provides no Developer ID signed, notarized
Snapback 2 artifact for a first-launch comparison. This diagnostic does not
repair or qualify the 0.5-second doctor budget.

Observed 2026-09-11 18:10–18:16 UTC by GPT-6 Astra. Repository HEAD was
`b3b063b4e2132c64ec90ef8e636052ef13b0dfe8`; the four inspected release/measurement
files were clean. Their content hashes are in [source-inspection.json](source-inspection.json).
The retained ticket and changed-binary benchmark records were read before
diagnosis. No known failed relink, ad-hoc signing experiment, Developer ID
private-key probe, or developer-mode experiment was repeated.

The npm registry reports `snapback2` and `snapback2-darwin-arm64` latest as
`0.0.23`. The published shim selects only that Darwin platform package. Both
the latest and preceding platform tarballs were downloaded directly from the
public registry and their exact SHA-512 integrity values verified before
inspection. Publication timestamps, URLs, tarball hashes, and package metadata
are retained in [registry-summary.json](registry-summary.json).

| Public package | Published UTC | CLI SHA-256 prefix | CLI and media signature | Notarization requirement |
| --- | --- | --- | --- | --- |
| 0.0.22 | 2026-09-10 23:01:22 | `1969ca63454a53e4` | Ad-hoc, linker-signed; no Team ID | Both fail, exit 3 |
| 0.0.23 | 2026-09-11 13:36:40 | `b6181c8535ab54d3` | Ad-hoc, linker-signed; no Team ID | Both fail, exit 3 |

All four executables have `flags=0x20002(adhoc,linker-signed)`,
`Signature=adhoc`, and `TeamIdentifier=not set`; the hardened-runtime flag is
absent. Ordinary `codesign --verify --strict` succeeds, establishing intact
ad-hoc signatures, not Developer ID distribution trust. Full binary hashes,
signature output, file types, dependencies and attributes are in
[binary-inspection.json](binary-inspection.json).

The additional read-only notarization check ran headlessly on the Bones M4
Mac mini after a capacity check: 10 logical CPUs, 16 GiB RAM, 60% system-wide
free memory, load average 1.75, about 2.1 GiB available disk, no active build
or test process (one idle Node/Codex session). The concurrency cap was one
static assessment; no build or timing workload was started. See
[remote-capacity.json](remote-capacity.json).

For each unchanged public binary, the command was:

```sh
codesign --verify --verbose=4 --test-requirement '=notarized' BINARY
```

Each result first confirmed disk validity, then failed the explicit notarized
requirement with exit 3. This is Apple's documented method for checking a
standalone binary's notarization, as distinct from signature validity.
[Apple WWDC19, All About Notarization](https://developer.apple.com/videos/play/wwdc2019/703/?time=831).
The exact commands, transferred-file hashes and output are retained in
[notarization-assessment.json](notarization-assessment.json). No Snapback
process was launched. These assessed copies would not be eligible for an
unassessed first-launch timing claim. The four owned remote copies and their
temporary directory were removed afterward; local public artifacts remain.
See [remote-cleanup.json](remote-cleanup.json).

The current publisher's `prepare` function builds the production media helper
and CLI, normally builds the Hermes-enabled CLI, qualifies doctor against the
staged compiler, copies both executables to the platform package, and packs
the tarballs. `main` runs installed-consumer qualification and publishes those
immutable tarballs. `scripts/hermes` only configures the Hermes Cargo build;
the npm shim only resolves and spawns the platform binary. There is no signing,
notarization, credential-profile selection or ticket step in those paths, and
no such step was found in the repository scripts or GitHub workflows. Relevant
source: `snapback2/scripts/publish.mjs:539` and `:901`,
`snapback2/scripts/hermes`, `snapback2/packages/snapback2/bin/snapback2.mjs`.

The concrete missing setup is a Developer ID Application private key usable
by the intended headless release job. The retained fleet inventory already
found the appropriate certificate on Black but its noninteractive signing
attempt failed with `errSecInternalComponent`; the Apple Development identities
on other Macs are not substitutes for ordinary notarized distribution. A
notary-service credential/profile must also be supplied to a future workflow;
none is referenced by the current publisher. This diagnostic did not inspect
credential contents or claim that no such credentials exist elsewhere.

Once that setup exists, the bounded implementation route is to sign the final
CLI and media helper with Developer ID, hardened runtime and secure timestamp;
qualify those exact bytes including the effects/media behavior; submit a ZIP
containing them to `notarytool`; verify acceptance; and retain the signed bytes
unchanged in the ordinary npm platform tarball. Use only entitlements actually
required by the executable; no broad exception is inferred merely because
Hermes is linked. These requirements follow
[Apple's notarization preparation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
This is proposed release work, not an existing usable route and not work
performed here.

Standalone executables cannot carry stapled tickets, and a ZIP cannot be
stapled directly. Their notarization ticket can be found online. Consequently,
ordinary signing/notarization cannot be assumed to remove all first-launch
network assessment or make 0.5 seconds pass. A staplable app/installer/container
would be a separate packaging choice, not a required consequence of using npm.
[Apple's custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

After producing usable signed/notarized artifacts, a meaningful control needs
two byte-distinct products on a capacity-checked remote Mac, preserving each
first external `doctor --json` observation and its adjacent second observation.
Validate signatures/notarization on a different host before measurement; do
not pre-assess or prelaunch the measured copies. Preserve package/compiler
identity, executable hashes, macOS version, acquisition/attribute state, host
load and every failed sample. Such a control tests the signed-release route;
its outcome remains unknown.

There is a separate policy boundary. `scripts/measure.mjs` currently builds
and directly times `target/release/snapback2`, preserving changed output's new
inode and first-execution cost. `publish.mjs` uses production artifacts.
Adding signing only to publication would not change the artifact measured by
the existing loop criterion. Closure therefore needs successful matched
changed-binary evidence for that criterion, or an explicit decision to change
which artifact/setup the criterion covers. Changing the budget, excluding OS
assessment, or treating a warmed launch as the first sample would be policy
changes, not performance repairs. None was made or recommended as evidence of
success here.

Outcome: diagnostic complete; no current signed-release control available.
Next actionable handoff is the existing Developer ID key's authorized,
noninteractive availability plus a concrete notarization credential reference,
followed by the bounded release integration and fresh control above. Product
source, security settings, keychains, identities, metrics and budgets are
unchanged; no source files were staged or committed, and the doctor ticket
remains open.
