# @ref LLP 0111#tls-admission-evidence-and-packaging — this image consumes a
# pre-verified closure only. Both bases are immutable multi-platform indexes;
# the release manifest records the selected platform manifests as well.
FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS caddy
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS node
FROM ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90

WORKDIR /app

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=caddy /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY closure/bin/ /app/bin/
COPY closure/lib/ /app/lib/
COPY closure/etc/ /app/etc/
COPY closure/generated/ /app/generated/
COPY closure/public/ /app/public/
COPY closure/share/ /app/share/

ENV PATH=/app/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LD_LIBRARY_PATH=/app/lib \
    HOME=/data/control \
    SNAPBACK_PROFILE=production \
    SNAPBACK_HOSTED_EDGE_CONFIG=/app/etc/hosted-edge.json \
    SNAPBACK_STARTUP_ARTIFACTS=/app/etc/startup-artifacts.json \
    SNAPBACK_HOSTED_ADMISSION_PATH=/data/control/admission.json \
    SNAPBACK_SUPERVISOR_ADMISSION_URL=https://snapback-hosted-supervisor-sjc.internal:8444/v1/target/admission

RUN set -eu; \
    chown -R 0:0 /app; \
    find /app -type d -exec chmod 0555 {} +; \
    find /app -type f -exec chmod 0444 {} +; \
    chmod 0555 /app/bin/snapback /app/bin/entrypoint.sh /app/bin/admission-renewer.sh /app/bin/hermesc; \
    mkdir -p /data/app /data/caddy /data/control /run/snapback; \
    chown -R 10001:10001 /data /run/snapback; \
    test -s /etc/ssl/certs/ca-certificates.crt; \
    ldd /usr/local/bin/node > /tmp/node.ldd; \
    ! grep -q 'not found' /tmp/node.ldd; \
    rm /tmp/node.ldd; \
    node --version; \
    hermesc --version | grep -q 'HBC bytecode version'; \
    snapback build-identity >/dev/null; \
    caddy version >/dev/null

USER 10001:10001
EXPOSE 8080 8443
ENTRYPOINT ["/app/bin/entrypoint.sh"]
