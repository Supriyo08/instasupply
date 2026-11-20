# syntax=docker/dockerfile:1
#
# InstaSupply API server. Build from the REPOSITORY ROOT (the server bundles packages/shared):
#
#   docker build --file backend/Dockerfile --tag instasupply-backend .
#
# What the build must produce is listed in docs/DEPLOYMENT.md §2.1:
#   backend/dist/server.js and backend/dist/cli.js, ES-module bundles that contain @instasupply/shared,
#   and backend/migrations/*.sql, read at run time relative to the built file.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: every dependency, then the bundle -----------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifests first, so this layer is rebuilt only when a dependency changes. Only the workspaces copied here
# are installed: npm skips workspace folders that are absent. `tsconfig*.json` may match nothing; naming
# package.json in the same COPY keeps that legal.
COPY package.json package-lock.json tsconfig*.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts --workspace @instasupply/backend --include-workspace-root

COPY packages/shared packages/shared
COPY backend backend
RUN npm run build --workspace @instasupply/backend \
 && test -f backend/dist/server.js \
 && test -f backend/dist/cli.js \
 && test -d backend/migrations

# ---- prod-deps: production node_modules only ------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
# @instasupply/shared is inside the bundle, so its workspace link is removed: a bundle that left it out
# fails at start, and therefore at the health check, instead of half-working.
RUN npm ci --ignore-scripts --omit=dev --workspace @instasupply/backend \
 && rm -rf node_modules/@instasupply \
 && mkdir -p backend/node_modules

# ---- runtime ----------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# Stack traces in the logs point at src/ files, not at lines of the bundle; this also covers the pre-deploy
# `node dist/cli.js migrate`, which runs in the same image.
ENV NODE_OPTIONS=--enable-source-maps
WORKDIR /app/backend
COPY --from=prod-deps /repo/node_modules /app/node_modules
COPY --from=prod-deps /repo/backend/node_modules /app/backend/node_modules
COPY --from=build /repo/backend/package.json /app/backend/package.json
COPY --from=build /repo/backend/dist /app/backend/dist
COPY --from=build /repo/backend/migrations /app/backend/migrations
# Only the "local" storage driver writes to disk (development, CI). Production uses the bucket.
RUN mkdir -p /app/backend/.data && chown node:node /app/backend/.data
# The official Node image ships the unprivileged user "node" (uid 1000).
USER node
EXPOSE 8080
# Node is started directly, not through npm, so that SIGTERM reaches the server.
CMD ["node", "dist/server.js"]
