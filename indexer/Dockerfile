# Self-hosted Plans indexer (Envio HyperIndex) for Railway: the same indexer as Envio Cloud, reading
# Monad testnet over public RPC (config.selfhost.yaml). Postgres and Hasura run as separate services.
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV ENVIO_CONFIG=config.selfhost.yaml TUI_OFF=true NODE_ENV=production
RUN pnpm envio codegen
CMD ["pnpm", "envio", "start"]
