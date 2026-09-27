#!/usr/bin/env bash
# @ref LLP 3000.021#3.3 — bundled sqlite.c and the Rust executable use musl
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
export CC_x86_64_unknown_linux_musl="${SNAPBACK4_MUSL_CC:-$HOME/.local/share/snapback4-musl-1.2.5/bin/musl-gcc}"
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER="$CC_x86_64_unknown_linux_musl"
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS='-C target-feature=+crt-static -C relocation-model=static'
# Prevent an ambient custom flag from overriding the target-specific static CRT.
unset CARGO_ENCODED_RUSTFLAGS RUSTFLAGS SNAPBACK4_BIN
unset LIBSQLITE3_SYS_USE_PKG_CONFIG SQLITE3_LIB_DIR SQLITE3_INCLUDE_DIR
unset CFLAGS TARGET_CFLAGS CFLAGS_x86_64_unknown_linux_musl
# cc-rs gives the hyphenated spellings priority over the underscored ones.
# Drop ambient overrides so the receipt describes the compiler actually used.
if ! command -v "$CC_x86_64_unknown_linux_musl" >/dev/null; then
  echo "musl compiler missing: $CC_x86_64_unknown_linux_musl; install musl under ~/.local or set SNAPBACK4_MUSL_CC to musl-gcc" >&2
  exit 1
fi
rustup target add x86_64-unknown-linux-musl
env -u CC_x86_64-unknown-linux-musl -u CFLAGS_x86_64-unknown-linux-musl cargo build --locked --profile production --target x86_64-unknown-linux-musl -p snapback4
node scripts/check-elf.mjs target/x86_64-unknown-linux-musl/production/snapback4
