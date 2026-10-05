# Round 2 independent source review

A fresh read-only Codex agent (`/root/round2_review`) read both supplied round-1
reviews and the round-2 source diff against `16fde56b53`. It found one additional
boundary reproduction: a decoded cache load received before reconnection but
above the last collected sequence still passed. The implementation now drains
the journal after backend readiness and the exported validator checks both the
sequence and timestamp boundary. The reproduction is retained as
`buffered-viewonce-load`; a driver test emits the load during backend startup.

Final reviewer verdict: **No residual material finding** in the reviewed source
diff. The reviewer independently reproduced the rejection and ran the four
current driver regression tests. Its review did not claim live qualification,
archive completeness or report validation; those are recorded separately.

Reviewed SHA-256:

- `driver/run.py`: `11e16638c8078527898d0bfcc9a56c8a7204a81551a5227c0b4745cea9dc7e64`
- `driver/evidence.py`: `fafcbf79b38904c9c6ae9515343f8adb881a51f0a3a2c45093c1d93d3224425b`

The source checkpoint is `65153829185e86a2c3d45d05ba5349ad5efd2286`.

A targeted follow-up reviewed the retained-read-state correction. Verdict:
**No material finding**. The reviewer verified the rebound early read screen
passes and that a newer `sent` screen still rejects the older read state. The
contract and LLP now explicitly allow the latest committed screen to predate
the window while requiring the native snapshot and server sample inside it.

Final source checkpoint: `152f7c182b26ee925033e7e7100c707df5aea6bb`.
Final `evidence.py` SHA-256: `af1ebce4cdb0218916886fcf48308439e011d703c6629696e3ce131d662cddef`.

Export validation exposed a further endpoint issue. The initial portability-only
judgment was superseded after a requested AVFoundation image at 120.7833 seconds
returned an image from 53.9483 seconds. Default image-generator tolerances did
not establish terminal decoding. A fresh targeted review required actual sample
decoding and coverage from sample timing, then reproduced an invented terminal
sample whose timing count exceeded the encoded sample count. Both are corrected.

Final endpoint review verdict: **No residual material finding**. The reviewer
ran all 32 rebound negative controls, normal and held-frame positives, and the
invented-sample reproduction. It statically reviewed full AVAssetReader decoding
and terminal-transition ordering. Live qualification is separately recorded.

Reviewed functional source hashes:

- `video.py`: `be1ea8a93a73e407044b64c3177d0598b13e1cd26b18073a5ebfd18cc681e89e`
- `video_timing.py`: `a9e6c4cbe4e8a91160fcc67d2794bb53b5d953389cee51c42c5707f60f1724c7`
- `video.swift`: `81b7466a88aaeaef2c22196317fd6944954ed1557efc9e02a80e47cf54c44517`
- `run.py`: `bb1ddc1ce9f3e586dde1b3169d649bf42ce73fa09e80e8c213f860b3b1f026b9`

A governing `@ref` comment was added to `video_timing.py` after that review;
its executable code is unchanged. The final source checkpoint is
`48a5a5fba9973f4e79ac152ec1808ecb6a5334db`.

## Continuation scope

The independent reviews above are historical records from the interrupted
session. They end at `48a5a5fba9`; they do not review `ed30bced26` or the
continuation's `66763bd858` correction. The continuation found and reproduced
AVFoundation's coalescing of distinct encoded samples with the same presentation
timestamp. It replaced presentation-order decoding with synchronous per-sample
VideoToolbox decoding, checked the original 1,344-sample recording, and added a
ten-sample repeated-timestamp regression. The final unit tests and live matrix
are separately recorded in the report; no new independent-review verdict is
claimed for these later commits.
