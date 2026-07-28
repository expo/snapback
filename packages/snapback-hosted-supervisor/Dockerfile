FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

WORKDIR /app
COPY package.json index.mjs external-store.mjs hosted-edge-admission.mjs \
  operator-authority.mjs operator-authority-transaction.mjs \
  operator-service.mjs provider-credentials.mjs provider-executor.mjs supervisor-response.mjs \
  service.mjs ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
RUN mkdir -p /data/control && chown -R node:node /app /data

USER node
ENV SNAPBACK_SUPERVISOR_DATA_DIR=/data/control
ENTRYPOINT ["node", "/app/service.mjs"]
