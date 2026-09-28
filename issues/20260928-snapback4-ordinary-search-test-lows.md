# Snapback 4: ordinary search test-strength Lows at landing

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/packages/snapback4/test/ordinary-search-ledger.test.mjs`, `ordinary-search-oracle.test.mjs`, `src/local-search.ts`
- **Found by:** the final reviews of lane OS (`os-r7.astra.md`, `os-r89.grok.md` on the EPYC host); non-blocking at landing

1. **The overlap proof has no negative case with a non-member.** The only negative proof is `Array(101).fill('m1000')`, which the length check alone rejects. Replacing `candidates.has(id)` with `true` (`local-search.ts:269`) passes every ledger test. Add a case whose `searchCurrent` is a single ID absent from `searchRetained` (length legal), expecting `E_INPUT` and no rows.
2. **The overlap charge constant is not locked.** Changing `current.length * 2` to `current.length` survives: the tight allowances use an empty proof. Add a tight-allowance case with a non-empty proof.
3. **Oracle refinements (Astra, round 7):** the cut fixtures accept an unjustified refusal; generated reuse never selects its matching replacement branch; the row model lets an expired replacement suppress retained history. Tighten each in the generated oracle.
