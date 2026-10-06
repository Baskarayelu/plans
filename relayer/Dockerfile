# Plans relayer — Node 24, TypeScript compiled to dist/. SQLite via built-in node:sqlite (no native deps).
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@9.15.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
