#!/usr/bin/env bash
# The Kani proofs of the key encoding (crates/snapback4-core/src/key_proofs.rs).
# Outside test.sh: they take minutes and up to ~12 GB each, and Kani is not a
# workspace dependency. Install once:
#   cargo install --locked kani-verifier && cargo kani setup
# Pass harness names to run a subset: scripts/kani.sh integers_keep_order_and_decode
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo-kani >/dev/null || { echo "kani: not installed (cargo install --locked kani-verifier && cargo kani setup)" >&2; exit 2; }
harnesses=()
for name in "$@"; do harnesses+=(--harness "$name"); done
# The proofs cover the interpreter's key and row code, which builds without
# the server's SQLite, so the dependency graph Kani compiles stays small.
exec cargo kani -p snapback4-core --no-default-features "${harnesses[@]}"
