# Codegen publication staging assumes its parent is writable and same-device

- Status: Open
- Date: 2026-08-26
- Systems: Code generation (`packages/snapback-codegen/index.mjs`,
  `packages/snapback-codegen/review-surface.mjs`)
- Governing: LLP 0310.000 Track C
- Related: `issues/closed/20260825-metro-exit-on-codegen-tmp.md` (the landing this
  concerns), `/Users/ccheever/projects/snapback-sbs-0310/p3` (an unlanded
  alternative implementation that verified the property this one assumes)

## Problem

`codegenPublicationStagingPaths` (LLP 0310.000 Track C, landed `bf5833047`)
places the candidate graph, the materialization copy, and the rollback backups
in a **sibling of the project root**:

```js
const projectRoot = codegenProjectRoot(backendRoot);
const publicationStagingRoot = join(
  dirname(projectRoot),
  `.${relative(dirname(projectRoot), projectRoot)}.snapback-codegen-${process.pid}-${randomBytes(12).toString('hex')}`,
);
```

That placement is what keeps the staging directory out of Metro's watch set,
which is the point of Track C. It also **inherits** the same-filesystem property
that `renameSync` needs, rather than checking for it, and it assumes the parent
directory is writable. Neither is verified.

Two states break it, and in both the failure arrives at publish time as a write
error rather than at placement time as a diagnosis:

1. **`dirname(projectRoot)` is not writable.** `mkdirSync` fails `EACCES`. A
   project checked out directly under a read-only or root-owned parent, or a
   sandbox that admits writes only inside the workspace, hits this. Agent
   sandboxes that grant workspace-write are exactly this shape.
2. **`projectRoot` is a filesystem boundary.** A project root that is itself a
   mount point, a bind or overlay mount, a container volume, or a network mount
   whose parent is local puts staging on a different device, and the
   complete-directory `renameSync` into `generated/` fails `EXDEV` — after the
   candidate graph has been fully built.

Neither is hypothetical for a product whose paved loop runs inside containers
and agent sandboxes.

## Prior art, unlanded

`/Users/ccheever/projects/snapback-sbs-0310/p3` holds a staged, never-landed
Track C implementation from a session that died mid-merge. It solves the same
problem differently and is worth reading before repairing this: it derives the
staging parent from a **candidate list** (`tmpdir()`, then `dirname(projectRoot)`),
skips any candidate inside the project root, and then verifies the
same-filesystem property with `statSync(parent).dev !== projectDevice` before
using it, falling through to the next candidate on mismatch.

Both designs are correct when the parent is writable and same-device. The
difference is only visible in the two states above, where p3 diagnoses at
placement and this one fails at publish. (A diff of that tree was snapshotted by
a concurrent session as `p3-staged-metro-prior-art.patch`; the worktree is
deliberately left in place because its staged content is on no pushed ref.)

## Direction

Do **not** move staging back inside the project root — that reintroduces the
`SNAPBACK_EXPO_METRO_EXITED` bug Track C exists to fix. Instead:

1. Verify the placement before building into it: writability, and
   `statSync(parent).dev === statSync(projectRoot).dev`.
2. On mismatch, fall through to another admitted candidate rather than
   proceeding — p3's candidate-list shape is the natural form.
3. If no candidate qualifies, refuse with a **coded** diagnostic that names the
   condition, rather than surfacing `EXDEV`/`EACCES` from `renameSync`/`mkdirSync`
   as an opaque codegen write failure.

## Not yet reproduced

Filed on a source reading, not an observed failure. A repro would be a codegen
run with the project root on a separate mount, or with its parent read-only.
