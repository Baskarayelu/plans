# Self-hosted Plans indexer (Envio HyperIndex) for Railway: the same indexer as Envio Cloud, reading
# Monad testnet over public RPC (config.selfhost.yaml). Postgres and Hasura run as separate services.
FROM node:22-bookworm-slim
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# `envio start` runs codegen at startup, when the database and Hasura settings are present.
ENV ENVIO_CONFIG=config.selfhost.yaml TUI_OFF=true
CMD ["pnpm", "envio", "start"]
