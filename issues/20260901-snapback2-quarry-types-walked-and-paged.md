# snapback2: Quarry types walked and paged rows as references

**Status:** Open
**Systems:** snapback2, quarry
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/program.ts:145-157, snapback2/packages/quarry/src/program.ts:228-243, snapback2/packages/quarry/src/program.ts:275-299, and snapback2/packages/quarry/src/program.ts:382-395. A walk or page yields row objects, but Quarry records them as `list<ref>`; accessing `ancestor.name` then emits an extra `db.get` using the row object as a key and fails at runtime instead of reading the returned row. Page result objects suffer the same row/reference mismatch. Model walk/page elements as rows (and page envelopes as their real object shapes), then make field lowering dereference only genuine reference values.
