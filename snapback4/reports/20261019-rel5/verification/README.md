# REL5 validation evidence

Packed source: 0819e24e7fcf77aaefdc5ca4933077c167f67c7a. Semantic review revision: 421a345ea16c1cc0486261e1b97c3469e45ec522. Later changes are documentation and test expectations only.

consumer.json is successful **consumer-only** qualification on the retained client/Expo/Linux tarballs, including Ubuntu 24.04 and Alpine through proot. It explicitly sets publicationQualified false; its source suite is not-run because scripts/test.sh was prohibited. release-transitions.json records all four requested cases plus the installed guide recipe. prepare.json binds the fresh input pack. No artifact was published.

cargo-coverage.json pairs the full runs with their corrective affected targets and the current Cargo metadata inventory: 412/412 targets, 6,618 passes, 45 opt-in ignored tests, no missing/failed targets. All five doctest suites pass. The initial five-crate command was stopped after CLI/core/device when it entered duplicated language work; the separate lang+sim run completed. Their original failure outputs remain preserved, not rewritten as successful exits. Corrective logs explain each final result. cargo-coverage.py is the one-off calculation used on the retained local logs; cargo-metadata.json.gz preserves its inventory.

Compressed logs retain the broad Rust runs, affected reruns, clients, Mac checks, root checks and both Linux consumer attempts. logs.json records raw digests and any test-session redactions. The first Linux attempt passed day-two business behavior, then exposed the old zero-warning H9 assertion; 0819e24e7f updates that and three related controls to require intentional result/rollback risks while keeping unchanged guards quiet. The full 42-case preview file and the fresh packed run pass.

sb4-rel5-replay.py is the exact one-off three-lane copy runner (local absolute paths). It removes only release-selection workarounds, checks original source hashes and removes copies in finally. Parent directory contains its six results and exact patches. Build the binary/client before reproducing; build outputs were removed after validation.

Private consumer apps, stores, dependencies and own target outputs are disposable and removed after evidence capture. Paths inside JSON identify executed scratch locations, not promised retained environments. Exact tarballs and root JSON remain locally under /home/ccheever/sb4-rel5-packs-verified and /home/ccheever/sb4-rel5-linux-verified.
