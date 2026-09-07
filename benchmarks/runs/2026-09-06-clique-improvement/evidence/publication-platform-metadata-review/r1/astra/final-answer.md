Verdict: REQUEST_CHANGES

Reviewed candidate `7884642fbddeb56bd18a03215e23c6761c76cd87` against parent `1bb06d52112a770257d3a64a4e2a3eeb8754fb4f`. Full findings and evidence are in [review.md](/Users/ccheever/clique-improvement/reviews/publication-platform-metadata-r1/astra/review.md).

**P2 — Unrelated optional dependencies are removed. Reproduced with synthetic metadata.** The prefix filter at [consumer-smoke.mjs:10](/Users/ccheever/clique-improvement/reviews/publication-platform-metadata-r1/astra/snapshot/snapback2/scripts/consumer-smoke.mjs:10) deletes every `snapback2-*` optional dependency. Selecting Darwin silently removed an unrelated `snapback2-plugin@1.2.3`. Both packing paths inherit this behavior. Restrict removal to platform identities.

Source inspection confirms that Darwin-only staging selects Darwin metadata and production checks packed identities before publication, including resumed artifacts. An older intact shim advertising Linux without its tarball is refused. Normal dependencies and peer metadata remain intact.

Both platforms remain representable in metadata. However, a second synthetic check showed that correctly matched Darwin/Linux tarballs pass verification but fail the production-style installation with `EBADPLATFORM`: every artifact becomes a required top-level dependency. This limitation also exists in the parent; it is distinct from the introduced finding.

The supplied six-test pass establishes fixture coverage, not compiled runtime qualification. It also does not validate the historical npm 11 locks: the separate publication consumer additionally lacks React, which the fixture supplies explicitly.

I ran exactly:

```sh
python3 run-local.py counterexample scratch/preserve-optional.mjs --purpose 'Check whether host-only staging preserves an unrelated snapback2-plugin optional dependency'
python3 run-local.py counterexample scratch/multiple-platform-install.mjs --purpose 'Check whether two correctly selected npm-packed platforms with os/cpu constraints survive the production mandatory-artifact install shape'
```

Results: exit **1** in **0.234s** for the preservation assertion; exit **1** in **5.930s** for the installation assertion, including npm’s actual `EBADPLATFORM` failure. Neither timed out. First failures and process records are preserved.

No self-test rerun, builds, runtime tests, network access, publication, or source/lock repairs were performed.