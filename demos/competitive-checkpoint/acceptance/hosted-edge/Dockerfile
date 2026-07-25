# LLP 0098 hosted-edge image: `loopback-terminated-single-instance.v1`.
#
# Same build stage as the plaintext drill image (../drill/Dockerfile) — see it
# for the Hermes bundle staging contract; the bundle is read from that same
# untracked directory. The runtime stage differs in exactly the way the profile
# requires:
#
#   - it adds Caddy as the in-namespace TLS terminator, so the public HTTPS leg
#     terminates inside this container rather than at the platform edge, and
#   - the origin binds loopback, so no address outside this network namespace
#     can reach it and LLP 0060 D2's edge-to-origin clause holds literally.
#
# It also ships the hosted-edge adapter configuration and the control plane's
# Ed25519 PUBLIC key. The private half never enters this image; that asymmetry
# is what makes the admission envelope an authenticated control-plane object
# rather than operator-supplied JSON (LLP 0098 §2.1).

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

# curl + debian-keyring/apt-transport for the Caddy apt repository.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4t64 libssl3t64 libicu74 ca-certificates sqlite3 bash curl \
        debian-keyring debian-archive-keyring apt-transport-https gnupg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
        > /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update && apt-get install -y --no-install-recommends caddy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/target/release/snapback /app/bin/snapback
COPY --from=build /src/target/release/drill-stream-source /app/bin/drill-stream-source
COPY --from=build /src/vendor/ibex/linux/lib/ /app/lib/
COPY demos/competitive-checkpoint/acceptance/hosted-edge/entrypoint.sh /app/bin/entrypoint.sh
COPY demos/competitive-checkpoint/acceptance/drill/backup-to-tigris.sh /app/bin/backup-to-tigris.sh
COPY demos/competitive-checkpoint/acceptance/hosted-edge/Caddyfile /app/etc/Caddyfile
# The adapter configuration and the control-plane PUBLIC key. Substituting
# either changes `configurationSha256`, which invalidates every admission
# snapshot signed against the original (LLP 0098 §3.1 clause 5).
COPY demos/competitive-checkpoint/acceptance/hosted-edge/hosted-edge.json /app/etc/hosted-edge.json
COPY demos/competitive-checkpoint/snapback/generated/ /app/checkpoint-generated/
COPY demos/competitive-checkpoint/snapback/seed.json /app/checkpoint-generated/seed.json

ENV LD_LIBRARY_PATH=/app/lib
ENV SNAPBACK_PROFILE=test
ENV SNAPBACK_OUTBOUND_ACTIONS=1

RUN chmod +x /app/bin/entrypoint.sh /app/bin/backup-to-tigris.sh

EXPOSE 8443 8080
ENTRYPOINT ["/app/bin/entrypoint.sh"]
