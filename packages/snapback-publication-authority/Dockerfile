FROM node:24.4.1-bookworm-slim

WORKDIR /app
COPY --chown=node:node . /app/
RUN install -d -m 0700 -o node -g node /data

USER node
ENV SNAPBACK_PUBLICATION_AUTHORITY_DATABASE=/data/publication-authority.sqlite3
ENV SNAPBACK_PUBLICATION_AUTHORITY_HOST=0.0.0.0
ENV SNAPBACK_PUBLICATION_AUTHORITY_PORT=8080
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "service.mjs"]
