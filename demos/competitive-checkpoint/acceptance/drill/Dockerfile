# single-instance-container-vm.v1 remote drill image (LLP 0075 amendment v0.6
# provider tuple; LLP 0076 decision 7 gate-2 receipt).
#
# Build context: the repository root (see .dockerignore there). The Linux
# Hermes runtime is NOT built here: the exact patched bundle
# hermes-linux-x64-<hermes-commit-12>-<patch-digest-12>.tar.gz — published by
# vendor/ibex's hermes-artifacts workflow for the pinned submodule commit and
# checksum-verified below — is staged untracked at
# demos/competitive-checkpoint/acceptance/drill/hermes/ by the operator. The
# drill receipt pins the bundle identity and sha256.
#
# Base image: ubuntu:24.04 in BOTH stages, deliberately matching the
# ubuntu-latest runner the bundle was built on (the bundle's hermesc and
# libhermesvm.so need its glibc; Debian bookworm's 2.36 cannot run them).
# Toolchain: rust-toolchain.toml pins 1.93.1 as the single compiler authority;
# rustup installs exactly that.

FROM ubuntu:24.04 AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build libcurl4-openssl-dev libssl-dev \
        zlib1g-dev curl ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path \
        --profile minimal --default-toolchain 1.93.1

WORKDIR /src

# Stage the prebuilt patched Hermes bundle into the vendored layout the ibex
# build.rs resolves on Linux (linux/hermes-headers, linux/lib, tools/hermes).
COPY demos/competitive-checkpoint/acceptance/drill/hermes/ /tmp/hermes-bundle/
RUN set -eu; \
    tarball="$(ls /tmp/hermes-bundle/hermes-linux-x64-*.tar.gz)"; \
    expected="$(awk 'NR == 1 { print $1 }' "$tarball.sha256")"; \
    actual="$(sha256sum "$tarball" | awk '{ print $1 }')"; \
    [ "$expected" = "$actual" ] || { echo "hermes bundle checksum mismatch: expected $expected got $actual" >&2; exit 1; }; \
    mkdir -p /tmp/hermes-install; \
    tar -C /tmp/hermes-install -xzf "$tarball"

COPY . .
RUN set -eu; \
    mkdir -p vendor/ibex/linux/hermes-headers vendor/ibex/linux/lib vendor/ibex/tools/hermes; \
    cp -R /tmp/hermes-install/include/. vendor/ibex/linux/hermes-headers/; \
    cp -R /tmp/hermes-install/lib/. vendor/ibex/linux/lib/; \
    cp /tmp/hermes-install/bin/hermesc vendor/ibex/tools/hermes/hermesc-linux-x64; \
    chmod +x vendor/ibex/tools/hermes/hermesc-linux-x64; \
    nm -D vendor/ibex/linux/lib/libhermesvm.so | grep -q ex_hermes_vm_current_package_id \
        || { echo "staged libhermesvm.so lacks the patched export" >&2; exit 1; }; \
    vendor/ibex/tools/hermes/hermesc-linux-x64 --version | grep -q "HBC bytecode version" \
        || { echo "staged hermesc cannot run in this build environment" >&2; exit 1; }

RUN cargo build --release --bin snapback

RUN rustc -O demos/competitive-checkpoint/acceptance/drill/stream-source.rs \
        -o /src/target/release/drill-stream-source

FROM ubuntu:24.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4t64 libssl3t64 libicu74 ca-certificates sqlite3 bash curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/target/release/snapback /app/bin/snapback
COPY --from=build /src/target/release/drill-stream-source /app/bin/drill-stream-source
COPY --from=build /src/vendor/ibex/linux/lib/ /app/lib/
COPY demos/competitive-checkpoint/acceptance/drill/entrypoint.sh /app/bin/entrypoint.sh
COPY demos/competitive-checkpoint/acceptance/drill/backup-to-tigris.sh /app/bin/backup-to-tigris.sh
# The generated artifact pair ships in-image so provenance/identity checks can
# compare the served instance against this exact checkout's clean build.
COPY demos/competitive-checkpoint/snapback/generated/ /app/checkpoint-generated/
COPY demos/competitive-checkpoint/snapback/seed.json /app/checkpoint-generated/seed.json

ENV LD_LIBRARY_PATH=/app/lib
ENV SNAPBACK_PROFILE=test
ENV SNAPBACK_OUTBOUND_ACTIONS=1

RUN chmod +x /app/bin/entrypoint.sh /app/bin/backup-to-tigris.sh

EXPOSE 8080
CMD ["/app/bin/entrypoint.sh"]
