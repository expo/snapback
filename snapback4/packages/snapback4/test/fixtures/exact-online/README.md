Zero synced tables, Exact's `typescript.sources.snapback4` online declaration,
a generated backend mount, and no device asset. The online adapter is copied
from Exact2 93a2e23efabbec2c9788017ac781fdf194d52264
(`snapback4/online/snapback.ts`), with its @ref rebound to the local handshake LLP; the gate test runs its query/write API against
dev and serve. Test-only symlinks materialize Exact's virtual TypeScript mounts.
