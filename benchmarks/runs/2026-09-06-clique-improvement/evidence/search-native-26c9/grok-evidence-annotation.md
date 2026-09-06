# Source-bound annotation to the retained Grok report

The adjacent `grok-review.md` is the complete final report verbatim, SHA-256 `d6364d338200bfee0a74c63a9a11d2ff1a6ec56130a514b550853c7b0ac5e434`. Its READY verdict is an independent static review; it did not execute tests, a server, or performance measurements. The raw progress prefix remains external and was not added to the final report.

The final paragraph's blanket description of supplied actual witnesses as using “short query terms, null optional fields” is too broad for the exact frozen source. In `snapback2/crates/snapback2-core/src/engine/search_guide_tests.rs` at commit `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`:

- Lines 100–101 build a 4,000-scalar body (`a` plus U+10100 repeated 3,999 times) and a 2,000-source-scalar query (`a` plus U+10100 repeated 1,999 times). The normalized matching token is short; the original input presented to normalization is the full declared width.
- Lines 112–125 populate photo, clip, and oncePhoto together with actual asset helper outputs. This particular wide row fixture does not leave those optional fields null.
- Line 219 executes the original `messages.send` path with U+1F82 repeated 4,000 times. The test observes 50 delivery writes and records actual execution work against the certificate.

Other controls do use short terms or null optional fields. Certificates remain conservative admission estimates, actual execution is separately recorded, and no native test proves every simultaneously worst-case combination. The correction above concerns the supplied fixture's actual width and populated fields. It does not change the reviewer verdict or add a scale, phone, package, or publication claim.

Source-backed qualification remains in the immutable final snapshot (`guide-native-v5-evidence-05.json`, `validation/guide-native-v5-05.log`, and native source inventory). The review's other practical limits remain in force.
