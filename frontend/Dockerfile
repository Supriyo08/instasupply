# syntax=docker/dockerfile:1
#
# InstaSupply web console (ops back office, supplier portal, tracking page). Build from the REPOSITORY ROOT:
#
#   docker build --file frontend/Dockerfile --build-arg VITE_API_URL=https://api.instasupply.ca \
#     --tag instasupply-frontend .
#
# The API address is baked into the bundle at build time. A different API address needs a new build.
#
# --build-arg CONSOLE_PLACEHOLDER=true replaces the Vite build with a one-page stand-in that has the same
# shape (index.html with #root, one fingerprinted /assets/*.js). It exists so that the image, the Caddyfile
# and the smoke test can be checked while the console does not compile yet; Railway never sets it.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2.11-alpine
ARG ALPINE_IMAGE=alpine:3.24

# ---- build: Vite ------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifests first. Add a line here when the console gains another workspace dependency.
COPY package.json package-lock.json tsconfig*.json ./
COPY frontend/package.json frontend/
COPY packages/shared/package.json packages/shared/
COPY packages/art/package.json packages/art/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --ignore-scripts --workspace @instasupply/frontend --include-workspace-root

COPY packages/shared packages/shared
COPY packages/art packages/art
COPY packages/api-client packages/api-client
COPY frontend frontend

# Railway hands service variables to the build as build arguments.
ARG VITE_API_URL
RUN case "${VITE_API_URL}" in \
      https://?* | http://localhost*) ;; \
      *) echo "VITE_API_URL must be the https:// address of the API (got '${VITE_API_URL}')." >&2; exit 1 ;; \
    esac
ENV VITE_API_URL=${VITE_API_URL}

# 1. regenerate the artwork module from packages/art/svg, 2. type-check and build the console (or write the
# stand-in), 3. keep source maps out of the public image, 4. record what this build points at (read by the
# smoke test).
ARG CONSOLE_PLACEHOLDER=false
RUN if [ "${CONSOLE_PLACEHOLDER}" = "true" ]; then \
      mkdir -p frontend/dist/assets \
      && printf 'document.getElementById("root").textContent = "InstaSupply console placeholder";\n' \
           > frontend/dist/assets/placeholder-00000000.js \
      && printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>InstaSupply</title>%s</head><body><div id="root"></div></body></html>\n' \
           '<script type="module" src="/assets/placeholder-00000000.js"></script>' > frontend/dist/index.html; \
    else \
      npm run build --workspace @instasupply/art \
      && npm run build --workspace @instasupply/frontend; \
    fi \
 && find frontend/dist -name '*.map' -delete \
 && printf '{"apiUrl":"%s","builtAt":"%s"}\n' "${VITE_API_URL}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > frontend/dist/build-info.json

# ---- caddy: validate the configuration, take the binary ---------------------------------------------------
FROM ${CADDY_IMAGE} AS caddy
COPY frontend/Caddyfile /etc/caddy/Caddyfile
# A broken Caddyfile fails the build. `install` makes a plain copy of the binary: the official image gives
# it the file capability cap_net_bind_service, which an unprivileged process on port 8080 does not need.
RUN PORT=8080 API_HOST=api.example.invalid caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
 && install -m 0755 /usr/bin/caddy /caddy

# ---- runtime ------------------------------------------------------------------------------------------------
FROM ${ALPINE_IMAGE} AS runtime
# mailcap provides /etc/mime.types (content types for fonts and other files Go does not know by itself).
RUN apk add --no-cache mailcap \
 && addgroup -S -g 10001 web \
 && adduser -S -D -H -u 10001 -G web web
COPY --from=caddy /caddy /usr/local/bin/caddy
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/frontend/dist /srv
ENV PORT=8080 XDG_CONFIG_HOME=/tmp/caddy/config XDG_DATA_HOME=/tmp/caddy/data
USER 10001:10001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
