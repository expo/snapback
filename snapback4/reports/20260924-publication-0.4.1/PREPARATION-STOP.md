# Snapback 4 0.4.1 publication — second attempt stopped

**Not published.** Stopped at the version-bump command under the explicit
“On any failure, stop and report the exact blocker” instruction. This is a
preparation failure, not a failed product test. No qualification was attempted.

## Exact blocker

The lane tried to apply the exact six-file version patch from first-attempt
commit `8e35a19f0e370cc3dd063da288d5750820b18c40` using `git apply`.
It exited 1 after 0.014 seconds:

```text
error: patch failed: snapback4/packages/snapback4/package.json:64
error: snapback4/packages/snapback4/package.json: patch does not apply
```

The old patch's optional-dependency hunk includes `openid-client` as the sole
runtime dependency in its context. The fix lane added `undici: 8.8.0`, changing
that context. Applying the whole historical diff was the lane's preparation
error; it does not indicate a defect in the fix lane's implementation.
The six version files remain unchanged, as verified by `git diff --exit-code`.
No partial patch, retry, manual version edit, or version commit followed.

Evidence: [command and timing](./version-bump.json),
[complete log](./version-bump.log), [exact attempted patch](./version-bump.patch).
To continue, the version edits need to be applied against the current manifests,
preserving the fix lane's new imports and Undici dependency. This was not attempted.

## Completed preparation

- Read the first attempt's report, the 0.4.0 report and the merged fix-lane journal.
- Fetched origin and created `~/projects/snapback-pub-041b` at the requested
  `0af449bb757b5a89f4df24a88f60cba681bf8b7d`.
- Renamed the old local branch to `sb4-intent/publish-041-attempt-1` to free
  `sb4-intent/publish-041` for this attempt. Old commit and worktree contents
  were preserved; no old report or journal was rewritten.
- Copied the old publication directory byte-for-byte to [attempt-1/](./attempt-1/).
  Copied its journal entry unchanged into this branch's append-only journal
  and [attempt-1-journal.md](./attempt-1-journal.md).
- Preserved its linked native evidence at
  [20260924-expo-0.4.1/](./20260924-expo-0.4.1/) within this report directory,
  so the old report's native-evidence link remains usable. No second-attempt
  native result was substituted for the first attempt's evidence.
- Ran the requested frozen Bun install on the pinned Node PATH: passed in
  0.964 seconds, Bun 1.4.2, 476 packages installed.

[Preservation hashes](./preservation.json) and [source record](./source.json).
The primary checkout's pre-existing uncommitted files were left untouched.

## Attempts and unrun steps

| Attempt | Seconds | Exit | Evidence |
|---|---:|---:|---|
| bun-install | 0.964 | 0 | [record](./bun-install.json), [log](./bun-install.log) |
| version-bump | 0.014 | 1 | [record](./version-bump.json), [log](./version-bump.log) |

No xcframework build, Release app build, native witness, publication dry run,
consumer proof, signing, resume, Expo packing/publication, or registry verification
ran in this attempt. There is no qualified binary digest or package integrity to
report. No keychain setting, credential, test, skip, assertion or budget changed.
No commit or branch push was made after the stop. Reports and journal are retained
uncommitted for the supervisor.

## Read-only preparation diagnostics

Before fetching, the local checkout lacked the 0.4.0 report and the requested
commit was not locally readable; both were read successfully after the fetch.
Two LLP reads used the wrong relative directory, and the first witness-card read
used an outdated path; the correct files were subsequently located and read.
An optional foundation glob matched no Snapback 4 entry. These read-only probes
made no changes and ran no build or test.

## Governing context

The `llp-orient` scope was version alignment, native qualification and publication.
LLP 3000 (in `llp/current/`) §4, “Fence, numbering, routing”, governs the
independent Snapback 4 workspace and publication path. Its §7,
“Decisions during execution”, is referenced by the publisher's packaged SQLite
policy and the xcframework script's native deployment minimum. The public witness
card and the 0.4.0 record supplied the native execution path. No design change or
LLP update was needed; skill hand-off: none. Remaining publication risks were not
assessed because execution stopped before qualification.
