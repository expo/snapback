# exact-result-types.fixture.ts cannot resolve @expo/snapback-client from demos/* without a hoisted node_modules/@expo

**Status:** Open
**Opened:** 2026-08-01
**Systems:** Packaging, Testing
**Related:** packages/snapback-react/exact-result-types.fixture.ts, demos/signal-desk/snapback/generated/api.d.ts, packages/snapback-codegen/index.mjs (the generated `import type { SearchPageV1 } from '@expo/snapback-client'` line)

Observed while running the 0137 between-arms fix lane, and reproduced
byte-for-byte in the primary checkout at 8bf7228d (this is NOT introduced by
the lane's changes):

`packages/snapback-react`'s `bun run test` final step compiles
`exact-result-types.fixture.ts`, which imports
`demos/signal-desk/snapback/generated/api.d.ts`. Generated `api.d.ts` opens
with `import type { SearchPageV1 as ClientSearchPageV1 } from
'@expo/snapback-client'`. TypeScript resolves that specifier relative to the
IMPORTING file — `demos/signal-desk/...` — and walks up to the repo root,
where `bun install` (workspaces `packages/*`) creates **no**
`node_modules/@expo/snapback-client` link (bun links the workspace package
only into dependents' own `node_modules`, e.g.
`packages/snapback-react/node_modules/@expo/snapback-client`). Result:

```
demos/signal-desk/snapback/generated/api.d.ts(2,57): error TS2307:
Cannot find module '@expo/snapback-client' or its corresponding type declarations.
```

so the fixture compile — and therefore the react package suite — fails on a
fresh `bun install` checkout (exit 2 verified in the primary checkout too).
Environments where it passes presumably carry a hoisted `node_modules/@expo`
from an older install layout.

Workaround used by this lane (machine-local, ignored path):

```sh
mkdir -p node_modules/@expo
ln -sfn ../../packages/snapback-client node_modules/@expo/snapback-client
```

Candidate real fixes (owner's pick): declare the `@expo/snapback-*`
workspace packages as root devDependencies so bun hoists them; or teach the
fixture compile a `paths` mapping for `@expo/snapback-client`; or have
codegen emit a relative type import in demo-local generated output. Any of
these should land with a fresh-checkout `bun install && bun run --cwd
packages/snapback-react test` witness.

---

**RESOLVED 2026-08-01 (fix-wave α1): fixed, not stale.** Root cause as
described — bun 1.3.x links workspace packages only into dependents'
node_modules, so generated api.d.ts imports of '@expo/snapback-client'
cannot resolve from demos/* on a fresh checkout. Fix:
scripts/ensure-workspace-hoist.mjs (idempotent root-level @expo/* links)
now runs first in packages/snapback-react's test chain. Verified in a
worktree that previously lacked the links: `bun run test` exit 0
including the tsc fixture leg.
