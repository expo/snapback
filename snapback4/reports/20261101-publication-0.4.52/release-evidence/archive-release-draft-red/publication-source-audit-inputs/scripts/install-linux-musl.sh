#!/usr/bin/env bash
# User-local toolchain; no system package installation or loader symlink.
# @ref LLP 3000.021#3.3 — the platform build uses a musl C compiler for bundled SQLite
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
prefix="$HOME/.local/share/snapback4-musl-1.2.5"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fL --retry 2 https://musl.libc.org/releases/musl-1.2.5.tar.gz -o "$work/musl.tar.gz"
printf '%s  %s\n' a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4 "$work/musl.tar.gz" | sha256sum -c -
tar -xzf "$work/musl.tar.gz" -C "$work"
cd "$work/musl-1.2.5"
env -u CROSS_COMPILE -u ARCH CC=gcc AR=ar RANLIB=ranlib ./configure --target=x86_64-linux-musl --prefix="$prefix" --syslibdir="$prefix/lib"
make -j"${CARGO_BUILD_JOBS:-8}"
make install
rustup target add x86_64-unknown-linux-musl
printf 'musl compiler: %s/bin/musl-gcc\n' "$prefix"
