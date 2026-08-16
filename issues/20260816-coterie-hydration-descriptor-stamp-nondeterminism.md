# Coterie hydration-descriptor stamp is build-nondeterministic (last-build-wins)

**Opened:** 2026-08-16
**Source:** Coterie slice-1 landing (LLP 0266; commits e548ae9dd/a3e61b9c4)

## Observation

`demos/coterie/public/__exact/hydration-build-descriptors.json` is a
committed file rewritten by every `bun run build` (exact-vite-plugin stamps
a sha256). Three consecutive builds of identical inputs during the slice-1
landing produced three different stamps:

- `5c613d4867…` (lane build)
- `23b798d46a…` (orchestrator re-verify, no intervening edits)
- `0a50cc199a…` / `35318839ea…` (fix-round builds)

So the committed bytes are just whichever build ran last, and any two
checkouts that both run `build` will show spurious diffs in this file.
`verify:coterie` does not gate on descriptor freshness, so nothing is red —
but the file cannot serve as drift evidence, and it adds noise to every
landing that runs a build.

## Ask

Either make the stamp deterministic for identical inputs (preferred —
likely a timestamp or unordered-input hash in exact-vite-plugin, i.e. an
Exact-side fix; Coterie does not patch the linked checkout), or stop
committing the descriptor file and generate it at build time like the
other ignored build outputs. If the Exact-side route is taken, this ticket
graduates to the Exact repo and closes here with a pointer.
